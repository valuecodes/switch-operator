import type { Logger } from "@repo/logger";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";

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
  "message": "notification message to send to the user (max 4000 chars, use markdown formatting)",
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

export { MAX_TOOL_ITERATIONS, OpenAiService, SCHEDULE_TOOLS };
export type { MonitorAnalysis, ToolExecutor, ToolResult };
