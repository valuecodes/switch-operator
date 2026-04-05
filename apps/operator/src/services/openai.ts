import type { Logger } from "@repo/logger";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

const SYSTEM_PROMPT = `You are a helpful personal assistant called Switch Operator. Be concise and helpful.

You can create, list, and delete scheduled messages for the user.
When the user asks to be reminded or wants something scheduled, use the create_schedule tool.
When creating schedules, infer the timezone from context or default to Europe/Helsinki.

Schedule types:
- hourly: runs every hour at the specified minute
- daily: runs every day at the specified hour:minute
- weekly: runs every week on the specified day at hour:minute
- monthly: runs every month on the specified day at hour:minute

Use fixed_message for exact text or message_prompt for AI-generated content.`;

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
];

type ToolResult = { result: string } | { error: string };
type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<ToolResult>;

const MAX_TOOL_ITERATIONS = 5;

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

  async replyWithTools(
    userMessage: string,
    toolExecutor: ToolExecutor
  ): Promise<string> {
    this.logger.debug("sending chat completion with tools", {
      messageLength: userMessage.length,
    });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

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
        return content;
      }

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") {
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
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: "Invalid tool arguments" }),
          });
          continue;
        }
        const result = await toolExecutor(toolCall.function.name, args);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    throw new Error("Tool calling exceeded maximum iterations");
  }
}

export { MAX_TOOL_ITERATIONS, OpenAiService, SCHEDULE_TOOLS };
export type { ToolExecutor, ToolResult };
