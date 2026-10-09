import type { Logger } from "@repo/logger";
import OpenAI from "openai";
import { z } from "zod";

import { MONITOR_ANALYSIS_PROMPT, SYSTEM_PROMPT } from "./openai-prompts";
import { askUserQuestionSchema, SCHEDULE_TOOLS } from "./openai-tools";
import type { QuestionOption } from "./pending-conversation";

const MAX_QUESTIONS_PER_CONVERSATION = 3;

// Tools that mutate persistent state. When the model emits one of these in
// the same assistant turn as ask_user_question, we refuse rather than
// execute it — otherwise we'd silently write a pending action that the
// user only sees after answering the question, leaving stale state if they
// don't.
const MUTATING_TOOLS = new Set(["create_schedule", "delete_schedule"]);

type ToolResult = { result: string } | { error: string };
type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<ToolResult>;

type ToolLoopMessages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

type ToolLoopOutcome =
  | { kind: "final"; content: string; messages: ToolLoopMessages }
  | {
      kind: "ask_user_question";
      question: string;
      options: QuestionOption[];
      toolCallId: string;
      messages: ToolLoopMessages;
    };

const MAX_TOOL_ITERATIONS = 5;

const buildInitialMessages = (userMessage: string): ToolLoopMessages => [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: userMessage },
];

const countAskUserQuestionCalls = (messages: ToolLoopMessages): number => {
  let count = 0;
  for (const m of messages) {
    if (m.role !== "assistant") {
      continue;
    }
    const toolCalls = m.tool_calls;
    if (!toolCalls) {
      continue;
    }
    for (const tc of toolCalls) {
      if (tc.type === "function" && tc.function.name === "ask_user_question") {
        count++;
      }
    }
  }
  return count;
};

const pushToolError = (
  messages: ToolLoopMessages,
  toolCallId: string,
  error: string
): void => {
  messages.push({
    role: "tool",
    tool_call_id: toolCallId,
    content: JSON.stringify({ error }),
  });
};

class OpenAiService {
  private readonly client: OpenAI;
  private readonly logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = new OpenAI({ apiKey, timeout: 25_000, maxRetries: 0 });
    this.logger = logger;
  }

  async reply(userMessage: string): Promise<string> {
    this.logger.debug("sending chat completion request", {
      messageLength: userMessage.length,
    });

    const response = await this.client.chat.completions.create({
      model: "gpt-5.4-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices[0]?.message.content;
    if (content === undefined || content === null || content === "") {
      throw new Error("OpenAI returned empty response");
    }

    this.logger.debug("chat completion received", {
      responseLength: content.length,
    });

    return content;
  }

  async runToolLoop(
    messages: ToolLoopMessages,
    toolExecutor: ToolExecutor
  ): Promise<ToolLoopOutcome> {
    this.logger.debug("running tool loop", {
      initialMessageCount: messages.length,
    });

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.client.chat.completions.create({
        model: "gpt-5.4-mini",
        max_completion_tokens: 2048,
        messages,
        tools: SCHEDULE_TOOLS,
      });

      const choice = response.choices[0];
      if (choice === undefined) {
        throw new Error("OpenAI returned no choices");
      }
      const message = choice.message;
      messages.push(message);

      const toolCalls = message.tool_calls ?? [];
      if (choice.finish_reason !== "tool_calls" || toolCalls.length === 0) {
        const content = message.content;
        if (content === null || content === "") {
          throw new Error("OpenAI returned empty response");
        }
        return { kind: "final", content, messages };
      }

      let pausedQuestion:
        | { question: string; options: QuestionOption[]; toolCallId: string }
        | undefined;

      // Pre-scan: if this batch contains an ask_user_question, mutating
      // sibling tool calls must be rejected (not executed) so we don't
      // commit hidden writes while the user only sees a question UI.
      const hasAskInBatch = toolCalls.some(
        (tc) =>
          tc.type === "function" && tc.function.name === "ask_user_question"
      );

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") {
          continue;
        }

        if (toolCall.function.name === "ask_user_question") {
          if (pausedQuestion) {
            // Only one ask_user_question per turn is honored; extras get
            // a tool error so the assistant turn is still well-formed.
            pushToolError(
              messages,
              toolCall.id,
              "Only one ask_user_question per assistant turn is supported."
            );
            continue;
          }

          let parsedArgs: unknown;
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            this.logger.error("failed to parse ask_user_question arguments", {
              arguments: toolCall.function.arguments,
            });
            pushToolError(messages, toolCall.id, "Invalid tool arguments");
            continue;
          }

          const validation = askUserQuestionSchema.safeParse(parsedArgs);
          if (!validation.success) {
            pushToolError(
              messages,
              toolCall.id,
              `Invalid ask_user_question args: ${validation.error.message}`
            );
            continue;
          }

          if (
            countAskUserQuestionCalls(messages) > MAX_QUESTIONS_PER_CONVERSATION
          ) {
            pushToolError(
              messages,
              toolCall.id,
              "Question quota exceeded — proceed without further questions."
            );
            continue;
          }

          pausedQuestion = {
            question: validation.data.question,
            options: validation.data.options,
            toolCallId: toolCall.id,
          };
          continue;
        }

        if (hasAskInBatch && MUTATING_TOOLS.has(toolCall.function.name)) {
          pushToolError(
            messages,
            toolCall.id,
            `${toolCall.function.name} cannot run in the same turn as ask_user_question. Wait for the user's answer, then call it on the next turn.`
          );
          continue;
        }

        this.logger.debug("executing tool call", {
          tool: toolCall.function.name,
          iteration: i,
        });

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments) as Record<
            string,
            unknown
          >;
        } catch {
          this.logger.error("failed to parse tool call arguments", {
            tool: toolCall.function.name,
            arguments: toolCall.function.arguments,
          });
          pushToolError(messages, toolCall.id, "Invalid tool arguments");
          continue;
        }
        const result = await toolExecutor(toolCall.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      if (pausedQuestion) {
        return {
          kind: "ask_user_question",
          question: pausedQuestion.question,
          options: pausedQuestion.options,
          toolCallId: pausedQuestion.toolCallId,
          messages,
        };
      }
    }

    throw new Error("Tool calling exceeded maximum iterations");
  }

  async replyWithTools(
    userMessage: string,
    toolExecutor: ToolExecutor
  ): Promise<string> {
    this.logger.debug("sending chat completion with tools", {
      messageLength: userMessage.length,
    });

    const messages = buildInitialMessages(userMessage);
    const outcome = await this.runToolLoop(messages, toolExecutor);
    if (outcome.kind !== "final") {
      throw new Error(
        "ask_user_question is not supported in replyWithTools — use runToolLoop directly to handle pause/resume."
      );
    }
    return outcome.content;
  }

  async analyzeMonitor(params: {
    task: string;
    scrapedContent: string;
    previousState: string | null;
  }): Promise<MonitorAnalysis> {
    this.logger.debug("analyzing monitor", {
      taskLength: params.task.length,
      contentLength: params.scrapedContent.length,
      hasPreviousState: params.previousState !== null,
    });

    const previousStateText =
      params.previousState ?? "First check — no previous state.";

    const response = await this.client.chat.completions.create({
      model: "gpt-5.4-mini",
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: MONITOR_ANALYSIS_PROMPT },
        {
          role: "user",
          content: `## Task\n${params.task}\n\n## Current page content\n${params.scrapedContent}\n\n## Previous state\n${previousStateText}`,
        },
      ],
    });

    const content = response.choices[0]?.message.content;
    if (content === undefined || content === null || content === "") {
      throw new Error("OpenAI returned empty response for monitor analysis");
    }

    const parsed: unknown = JSON.parse(content);
    return monitorAnalysisSchema.parse(parsed);
  }
}

const monitorAnalysisSchema = z.object({
  notify: z.boolean(),
  message: z.string().max(4000),
  newState: z.string().max(5000),
});

type MonitorAnalysis = z.infer<typeof monitorAnalysisSchema>;

export { buildInitialMessages, OpenAiService };
export type { ToolExecutor, ToolLoopMessages, ToolLoopOutcome, ToolResult };
