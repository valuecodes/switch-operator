import type { Context } from "hono";

import { OpenAiService } from "../../services/openai";
import type { ToolExecutor, ToolResult } from "../../services/openai";
import { PendingActionService } from "../../services/pending-action";
import type { PendingAction } from "../../services/pending-action";
import {
  createScheduleSchema,
  MAX_ACTIVE_SCHEDULES,
  ScheduleService,
} from "../../services/schedule";
import type { CreateScheduleInput } from "../../services/schedule";
import { TelegramService } from "../../services/telegram";
import type { AppEnv } from "../../types/env";
import type { TelegramUpdate } from "../../types/telegram";
import { splitMessage } from "../../utils/message";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  description: (args.description as string | undefined) ?? "",
});

const executePendingAction = async (
  action: PendingAction,
  chatId: number,
  db: D1Database,
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void }
): Promise<string> => {
  const scheduleService = new ScheduleService(db);

  if (action.type === "create_schedule") {
    const input = action.payload as unknown as CreateScheduleInput;
    const row = await scheduleService.create(chatId, input);
    logger.info("schedule created", { scheduleId: row.id });
    return `Schedule created: ${action.description}\nID: ${row.id}\nNext run: ${row.nextRunAt}`;
  }

  // delete_schedule
  const id = action.payload.id as string;
  const deleted = await scheduleService.remove(id, chatId);
  if (deleted) {
    logger.info("schedule deleted", { scheduleId: id });
    return `Schedule ${id} has been deleted.`;
  }
  return `Schedule ${id} not found or already deleted.`;
};

type WebhookInput = {
  in: { json: TelegramUpdate };
  out: { json: TelegramUpdate };
};

const handleWebhook = async (c: Context<AppEnv, string, WebhookInput>) => {
  const logger = c.get("logger");
  const update = c.req.valid("json");
  const message = update.message;
  const isAllowedChat =
    message !== undefined && String(message.chat.id) === c.env.ALLOWED_CHAT_ID;

  logger.debug("incoming update", {
    updateId: update.update_id,
    hasMessage: message !== undefined,
    hasText: message?.text !== undefined,
  });
  logger.debug("chat authorization check", {
    updateId: update.update_id,
    isAllowedChat,
  });

  if (!message?.text) {
    return c.json({ ok: true });
  }

  if (!isAllowedChat) {
    logger.warn("chat not allowed, ignoring", { updateId: update.update_id });
    return c.json({ ok: true });
  }

  const chatId = message.chat.id;
  logger.info("message received from allowed chat", {
    updateId: update.update_id,
    textLength: message.text.length,
  });
  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN, logger);
  const pendingService = new PendingActionService(c.env.DB);

  // Check for pending confirmation
  const pending = await pendingService.get(chatId);
  if (pending) {
    const confirmed = message.text.trim().toUpperCase() === "YES";

    if (confirmed) {
      const result = await executePendingAction(
        pending,
        chatId,
        c.env.DB,
        logger
      );
      await pendingService.clear(chatId);
      for (const chunk of splitMessage(result)) {
        await telegram.sendMessage({ chat_id: chatId, text: chunk });
      }
      return c.json({ ok: true });
    }

    await pendingService.clear(chatId);
    await telegram.sendMessage({
      chat_id: chatId,
      text: "Action cancelled.",
    });
    // Fall through to process the message normally if it wasn't just "YES"/"NO"
    const isSimpleResponse =
      message.text.trim().length <= 3 ||
      message.text.trim().toUpperCase() === "NO";
    if (isSimpleResponse) {
      return c.json({ ok: true });
    }
  }

  const scheduleService = new ScheduleService(c.env.DB);

  const toolExecutor: ToolExecutor = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> => {
    logger.debug("tool call received", { tool: name });

    if (name === "list_schedules") {
      const list = await scheduleService.list(chatId);
      return {
        result: JSON.stringify(
          list.map((s) => ({
            id: s.id,
            type: s.scheduleType,
            description: s.description,
            hour: s.hour,
            minute: s.minute,
            dayOfWeek: s.dayOfWeek,
            dayOfMonth: s.dayOfMonth,
            timezone: s.timezone,
            sourceUrl: s.sourceUrl,
            nextRunAt: s.nextRunAt,
          }))
        ),
      };
    }

    if (name === "create_schedule") {
      const count = await scheduleService.countActive(chatId);
      if (count >= MAX_ACTIVE_SCHEDULES) {
        return {
          error: `Quota exceeded: maximum ${String(MAX_ACTIVE_SCHEDULES)} active schedules`,
        };
      }

      const input = mapToolArgsToInput(args);
      const validation = createScheduleSchema.safeParse(input);
      if (!validation.success) {
        return { error: validation.error.message };
      }

      // Monitor support (source_url) is not yet implemented — reject
      if (input.sourceUrl) {
        return { error: "URL monitors are not yet supported" };
      }

      // Store as pending in D1 — require user confirmation
      await pendingService.set(chatId, {
        type: "create_schedule",
        payload: input as unknown as Record<string, unknown>,
        description: formatScheduleDescription("create", args),
      });

      return {
        result: `Confirmation required. I've asked the user to confirm: "${formatScheduleDescription("create", args)}". Tell the user to reply YES to confirm.`,
      };
    }

    if (name === "delete_schedule") {
      const id = args.id as string | undefined;
      if (!id) {
        return { error: "Missing schedule ID" };
      }

      // Store as pending in D1 — require user confirmation
      await pendingService.set(chatId, {
        type: "delete_schedule",
        payload: { id },
        description: `Delete schedule ${id}`,
      });

      return {
        result: `Confirmation required. I've asked the user to confirm deletion of schedule ${id}. Tell the user to reply YES to confirm.`,
      };
    }

    return { error: `Unknown tool: ${name}` };
  };

  let reply: string;
  try {
    const openai = new OpenAiService(c.env.OPENAI_API_KEY, logger);
    reply = await openai.replyWithTools(message.text, toolExecutor);
  } catch (error) {
    logger.error("openai request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    reply =
      "Something went wrong while generating a response. Please try again.";
  }

  for (const chunk of splitMessage(reply)) {
    await telegram.sendMessage({
      chat_id: chatId,
      text: chunk,
    });
  }

  return c.json({ ok: true });
};

export { handleWebhook };
