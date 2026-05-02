import type { QuestionOption } from "../../services/pending-conversation";
import type { CreateScheduleInput } from "../../services/schedule";
import type { InlineKeyboardMarkup } from "../../types/telegram";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const QUESTION_BUTTON_LABEL_MAX = 32;

const formatScheduleDescription = (
  type: string,
  args: Record<string, unknown>
): string => {
  const schedType =
    typeof args.schedule_type === "string" ? args.schedule_type : type;
  const parts: string[] = [`${schedType} schedule`];
  if (args.hour != null) {
    const h = typeof args.hour === "number" ? String(args.hour) : "0";
    const m =
      typeof args.minute === "number"
        ? String(args.minute).padStart(2, "0")
        : "00";
    parts.push(`at ${h}:${m}`);
  }
  if (typeof args.day_of_week === "number") {
    parts.push(`on ${DAYS[args.day_of_week] ?? "?"}`);
  }
  if (typeof args.day_of_month === "number") {
    parts.push(`on day ${String(args.day_of_month)}`);
  }
  const tz = typeof args.timezone === "string" ? args.timezone : "UTC";
  parts.push(`(${tz})`);
  if (args.use_browser === true) {
    parts.push("(browser rendering)");
  }
  if (typeof args.description === "string") {
    parts.push(`— "${args.description}"`);
  }
  return parts.join(" ");
};

const mapToolArgsToInput = (
  args: Record<string, unknown>
): CreateScheduleInput => ({
  scheduleType: args.schedule_type as CreateScheduleInput["scheduleType"],
  hour: args.hour as number | undefined,
  minute: args.minute as number | undefined,
  dayOfWeek: args.day_of_week as number | undefined,
  dayOfMonth: args.day_of_month as number | undefined,
  timezone: (args.timezone as string | undefined) ?? "Europe/Helsinki",
  fixedMessage: args.fixed_message as string | undefined,
  messagePrompt: args.message_prompt as string | undefined,
  sourceUrl: args.source_url as string | undefined,
  keywords: args.keywords as string[] | undefined,
  useBrowser: args.use_browser as boolean | undefined,
  description: (args.description as string | undefined) ?? "",
});

const buildConfirmationKeyboard = (token: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "✅ Yes", callback_data: `c:${token}` },
      { text: "❌ No", callback_data: `x:${token}` },
    ],
  ],
});

const truncateLabel = (label: string, max: number): string =>
  label.length <= max ? label : `${label.slice(0, max - 1)}…`;

const buildQuestionKeyboard = (
  token: string,
  options: QuestionOption[]
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    options.map((opt, idx) => ({
      text: truncateLabel(opt.label, QUESTION_BUTTON_LABEL_MAX),
      callback_data: `q:${token}:${String(idx)}`,
    })),
  ],
});

export {
  buildConfirmationKeyboard,
  buildQuestionKeyboard,
  formatScheduleDescription,
  mapToolArgsToInput,
};
