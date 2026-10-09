import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";

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
          summary: {
            type: "string",
            description:
              "Human-readable summary of the schedule being deleted (e.g. 'daily monitor at 9:00 — Twitter Elon'). Shown in the user's confirmation prompt so they can recognize what's about to be deleted. Build this from the matching list_schedules entry: include schedule type, time, and description.",
          },
        },
        required: ["id", "summary"],
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

export { askUserQuestionSchema, SCHEDULE_TOOLS };
