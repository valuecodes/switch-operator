import type { Logger } from "@repo/logger";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";

import type { QuestionOption } from "./pending-conversation";

const SYSTEM_PROMPT = `You are a helpful personal assistant called Switch Operator. Be concise and helpful.

You can create, list, and delete scheduled messages for the user.
When the user asks to be reminded or wants something scheduled, use the create_schedule tool.
When creating schedules, infer the timezone from context or default to Europe/Helsinki.

Schedule types:
- hourly: runs every hour at the specified minute
- daily: runs every day at the specified hour:minute
- weekly: runs every week on the specified day at hour:minute
- monthly: runs every month on the specified day at hour:minute

Use fixed_message for exact text or message_prompt for AI-generated content.

You can also create web monitors that scrape a URL on a schedule and notify based on conditions.
When the user wants to monitor a website for changes or check for specific content, use create_schedule with source_url + message_prompt.
The message_prompt should describe what to look for or how to analyze the page content.

For monitors with large pages, use the keywords parameter to pre-filter content before AI analysis.
When keywords are set, the system only calls AI if at least one keyword appears on the page — saving time and cost.

Use the use_browser parameter (boolean) on create_schedule to opt a monitor into JavaScript rendering via the browser scraper.
Whenever source_url is set on a create_schedule call, you MUST first call ask_user_question to confirm whether the monitor needs the browser scraper. Do not infer use_browser from the URL. Do not omit it. Do not call create_schedule and ask_user_question in the same turn — emit ask_user_question alone, then call create_schedule after the user's answer arrives, passing the chosen boolean verbatim into create_schedule.use_browser.
Use this exact form for the question:
  question: "Should I use the browser scraper for this page (renders JavaScript)?"
  options:
    - { label: "Yes — needs JS rendering", value: true }
    - { label: "No — static HTML", value: false }

Do not ask about timezones, schedule types, or anything you can derive from the user's wording.

Monitor examples:
- "Notify me when Beck is on TV" → source_url with the TV listings page, message_prompt: "Check if Beck appears in today's listings. Notify with channel and time if found.", keywords: ["Beck"]
- "Weekly report changes" → source_url with the report page, message_prompt: "Compare this week's content to last week. Summarize key changes."

When listing schedules, format them as a numbered list (1, 2, 3...) with key details like description, type, time, and next run.
When the user asks to delete a schedule by number, first call list_schedules to get the current list, then use the ID from the matching position to call delete_schedule.`;

const SCHEDULE_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_schedule",
      description:
        "Create a new scheduled message. Use fixed_message for exact text or message_prompt for AI-generated content.",
      parameters: {
        type: "object",
        properties: {
          schedule_type: {
            type: "string",
            enum: ["hourly", "daily", "weekly", "monthly"],
          },
          hour: {
            type: "number",
            description: "Hour (0-23). Required for daily/weekly/monthly.",
          },
          minute: {
            type: "number",
            description: "Minute (0-59). Defaults to 0.",
          },
          day_of_week: {
            type: "number",
            description: "Day of week (0=Sun, 6=Sat). Required for weekly.",
          },
          day_of_month: {
            type: "number",
            description: "Day of month (1-28). Required for monthly.",
          },
          timezone: {
            type: "string",
            description:
              "IANA timezone (e.g. Europe/Helsinki). Defaults to Europe/Helsinki.",
          },
          fixed_message: {
            type: "string",
            description:
              "Exact message to send. Mutually exclusive with message_prompt.",
          },
          message_prompt: {
            type: "string",
            description:
              "Prompt for AI-generated message. Mutually exclusive with fixed_message.",
          },
          source_url: {
            type: "string",
            description:
              "URL to monitor/scrape. When set, the schedule becomes a monitor: it will fetch this URL on each run, analyze the content using message_prompt, and notify only if the condition is met. Requires message_prompt. Cannot be used with fixed_message.",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional keywords to pre-filter scraped page content before AI analysis. When set, only runs AI if at least one keyword appears on the page. Use for efficiency on large pages. Only valid for monitors (requires source_url).",
          },
          use_browser: {
            type: "boolean",
            description:
              "When true, the monitor fetches via the browser scraper which executes JavaScript. Only useful for SPA / JS-rendered pages. Required whenever source_url is set — confirm the value with the user via ask_user_question before calling create_schedule.",
          },
          description: {
            type: "string",
            description: "Short description of this schedule (max 200 chars).",
          },
        },
        required: ["schedule_type", "timezone", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_schedules",
      description: "List all active schedules for the user.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_schedule",
      description: "Delete (deactivate) a schedule by its ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The schedule ID to delete." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user_question",
      description:
        "Ask the user a clarifying question with 2–4 button-labeled options. REQUIRED before every create_schedule call that has source_url set, to confirm use_browser. Otherwise use whenever a tool parameter affects observable behavior and you are not certain. The selected option's value flows back as the tool result; pass it directly into the appropriate downstream tool parameter (boolean for yes/no, string for choices).",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to display to the user (max 500 chars).",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  description: "Short button label (max 100 chars).",
                },
                value: {
                  description:
                    "Opaque value passed back as the tool result when this option is chosen. Type matches the downstream parameter (boolean for yes/no, string for choices, number for counts).",
                  anyOf: [
                    { type: "boolean" },
                    { type: "string" },
                    { type: "number" },
                  ],
                },
              },
              required: ["label", "value"],
            },
          },
        },
        required: ["question", "options"],
      },
    },
  },
];

const questionOptionSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.union([z.boolean(), z.string(), z.number()]),
});

const askUserQuestionSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(questionOptionSchema).min(2).max(4),
});

const MAX_QUESTIONS_PER_CONVERSATION = 3;

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
    if (!content) {
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
      const message = choice.message;
      messages.push(message);

      if (
        choice.finish_reason !== "tool_calls" ||
        !message.tool_calls?.length
      ) {
        const content = message.content;
        if (!content) {
          throw new Error("OpenAI returned empty response");
        }
        return { kind: "final", content, messages };
      }

      let pausedQuestion:
        | { question: string; options: QuestionOption[]; toolCallId: string }
        | undefined;

      for (const toolCall of message.tool_calls) {
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
      hasPreviousState: params.previousState != null,
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
    if (!content) {
      throw new Error("OpenAI returned empty response for monitor analysis");
    }

    const parsed: unknown = JSON.parse(content);
    return monitorAnalysisSchema.parse(parsed);
  }
}

const MONITOR_ANALYSIS_PROMPT = `You are analyzing a web page for a monitoring task.

The user will provide:
1. A task describing what to check or monitor
2. The current page content (scraped and converted to markdown)
3. Previous state from the last check (or "First check" if this is the first run)

Respond in JSON with exactly these fields:
{
  "notify": true or false,
  "message": "notification message to send to the user (max 4000 chars, use markdown — bold, italic, lists, links, code, blockquote; headers render as bold)",
  "newState": "concise summary of current state for comparison next time (max 5000 chars)"
}

Rules:
- Only set "notify" to true if the condition described in the task is met
- For diff/change detection tasks: compare current content to previous state and summarize what changed. Notify if there are meaningful changes.
- For condition check tasks: evaluate whether the specific condition is satisfied. Notify only if it is.
- The "message" should be informative and actionable — include relevant details from the page
- The "newState" should contain enough information to compare against next time. Keep it concise.
- If this is the first check, always set notify to true with a summary of current state`;

const monitorAnalysisSchema = z.object({
  notify: z.boolean(),
  message: z.string().max(4000),
  newState: z.string().max(5000),
});

type MonitorAnalysis = z.infer<typeof monitorAnalysisSchema>;

export {
  buildInitialMessages,
  countAskUserQuestionCalls,
  MAX_QUESTIONS_PER_CONVERSATION,
  MAX_TOOL_ITERATIONS,
  OpenAiService,
  SCHEDULE_TOOLS,
  SYSTEM_PROMPT,
};
export type {
  MonitorAnalysis,
  ToolExecutor,
  ToolLoopMessages,
  ToolLoopOutcome,
  ToolResult,
};
