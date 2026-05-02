import type { Logger } from "@repo/logger";
import type { Context } from "hono";

import { PendingActionService } from "../../services/pending-action";
import type { PendingAction } from "../../services/pending-action";
import { PendingConversationService } from "../../services/pending-conversation";
import { ScheduleService } from "../../services/schedule";
import type { CreateScheduleInput } from "../../services/schedule";
import { TelegramService } from "../../services/telegram";
import type { AppEnv } from "../../types/env";
import type {
  TelegramCallbackQuery,
  TelegramUpdate,
} from "../../types/telegram";
import { splitMessage } from "../../utils/message";
import { parseCallbackData } from "./callback-data";
import type { ParsedCallback } from "./callback-data";
import { ConversationRunner } from "./conversation-runner";

const executePendingAction = async (
  action: PendingAction,
  chatId: number,
  db: D1Database,
  logger: Logger
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
  const update = c.req.valid("json");
  if (update.callback_query) {
    return handleCallbackQuery(c, update.callback_query);
  }
  return handleMessage(c, update);
};

const handleMessage = async (
  c: Context<AppEnv, string, WebhookInput>,
  update: TelegramUpdate
) => {
  const logger = c.get("logger");
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

  // Typed-YES fallback path. Atomically claim any non-expired pending row
  // so a concurrent button tap can't also execute it.
  const consumed = await pendingService.consumeByChatId(chatId);
  if (consumed) {
    const confirmed = message.text.trim().toUpperCase() === "YES";

    if (confirmed) {
      const result = await executePendingAction(
        consumed,
        chatId,
        c.env.DB,
        logger
      );
      for (const chunk of splitMessage(result)) {
        await telegram.sendMessage({ chat_id: chatId, text: chunk });
      }
      return c.json({ ok: true });
    }

    await telegram.sendMessage({
      chat_id: chatId,
      text: "Action cancelled.",
    });
    const isSimpleResponse =
      message.text.trim().length <= 3 ||
      message.text.trim().toUpperCase() === "NO";
    if (isSimpleResponse) {
      return c.json({ ok: true });
    }
  }

  const runner = new ConversationRunner(chatId, c.env, logger, telegram);
  await runner.startFromMessage(message.text);
  return c.json({ ok: true });
};

const handleCallbackQuery = async (
  c: Context<AppEnv, string, WebhookInput>,
  cq: TelegramCallbackQuery
) => {
  const logger = c.get("logger");
  const allowedChatId = c.env.ALLOWED_CHAT_ID;
  const fromAllowed = String(cq.from.id) === allowedChatId;

  if (!fromAllowed) {
    logger.warn("callback_query not allowed, ignoring", {
      callbackId: cq.id,
    });
    return c.json({ ok: true });
  }

  const cqChatId = cq.message?.chat.id;
  if (cqChatId !== undefined && String(cqChatId) !== allowedChatId) {
    logger.warn("callback_query not allowed, ignoring", {
      callbackId: cq.id,
    });
    return c.json({ ok: true });
  }

  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN, logger);
  const messageId = cq.message?.message_id;
  const chatId = cq.message?.chat.id;

  if (chatId === undefined) {
    // Inaccessible message stub — no chat to act on. Ack and stop.
    await telegram
      .answerCallbackQuery({ callback_query_id: cq.id })
      .catch(() => undefined);
    return c.json({ ok: true });
  }

  const parsed = parseCallbackData(cq.data);
  if (!parsed) {
    logger.warn("callback_query has malformed data", { callbackId: cq.id });
    await telegram
      .answerCallbackQuery({ callback_query_id: cq.id, text: "Malformed" })
      .catch(() => undefined);
    return c.json({ ok: true });
  }

  if (parsed.action === "answer") {
    await handleAnswerCallback(
      c,
      cq,
      parsed,
      chatId,
      messageId,
      telegram,
      logger
    );
    return c.json({ ok: true });
  }

  await handleConfirmOrCancel(
    c,
    cq,
    parsed,
    chatId,
    messageId,
    telegram,
    logger
  );
  return c.json({ ok: true });
};

const ackAndClearKeyboard = async (
  cq: TelegramCallbackQuery,
  chatId: number,
  messageId: number | undefined,
  telegram: TelegramService,
  logger: Logger,
  toast: string | undefined
): Promise<void> => {
  await telegram
    .answerCallbackQuery({ callback_query_id: cq.id, text: toast })
    .catch((err: unknown) => {
      logger.warn("answerCallbackQuery failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  if (messageId !== undefined) {
    await telegram
      .editMessageReplyMarkup({ chat_id: chatId, message_id: messageId })
      .catch((err: unknown) => {
        logger.warn("editMessageReplyMarkup failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }
};

const handleConfirmOrCancel = async (
  c: Context<AppEnv, string, WebhookInput>,
  cq: TelegramCallbackQuery,
  parsed: Extract<ParsedCallback, { action: "confirm" | "cancel" }>,
  chatId: number,
  messageId: number | undefined,
  telegram: TelegramService,
  logger: Logger
): Promise<void> => {
  const pendingService = new PendingActionService(c.env.DB);
  let toast: string | undefined;
  let resultMessage: string | undefined;
  try {
    const consumed = await pendingService.consumeByToken(chatId, parsed.token);
    if (!consumed) {
      toast = "Expired or already used";
    } else if (parsed.action === "cancel") {
      toast = "Cancelled";
    } else {
      resultMessage = await executePendingAction(
        consumed,
        chatId,
        c.env.DB,
        logger
      );
      toast =
        consumed.type === "create_schedule"
          ? "Schedule created"
          : "Schedule deleted";
    }
  } catch (error) {
    logger.error("callback execution failed", {
      callbackId: cq.id,
      error: error instanceof Error ? error.message : String(error),
    });
    toast = "Something went wrong";
  } finally {
    await ackAndClearKeyboard(cq, chatId, messageId, telegram, logger, toast);
  }

  if (resultMessage) {
    for (const chunk of splitMessage(resultMessage)) {
      await telegram.sendMessage({ chat_id: chatId, text: chunk });
    }
  }
};

const handleAnswerCallback = async (
  c: Context<AppEnv, string, WebhookInput>,
  cq: TelegramCallbackQuery,
  parsed: Extract<ParsedCallback, { action: "answer" }>,
  chatId: number,
  messageId: number | undefined,
  telegram: TelegramService,
  logger: Logger
): Promise<void> => {
  const conversationService = new PendingConversationService(c.env.DB);
  const consumed = await conversationService.consumeByToken(
    chatId,
    parsed.token
  );

  if (!consumed) {
    await ackAndClearKeyboard(
      cq,
      chatId,
      messageId,
      telegram,
      logger,
      "Expired or already used"
    );
    return;
  }

  if (parsed.optionIndex < 0 || parsed.optionIndex >= consumed.options.length) {
    logger.warn("answer callback option index out of range", {
      callbackId: cq.id,
      optionIndex: parsed.optionIndex,
      optionsLength: consumed.options.length,
    });
    await ackAndClearKeyboard(
      cq,
      chatId,
      messageId,
      telegram,
      logger,
      "Invalid option"
    );
    return;
  }

  // Ack the click immediately so the user's button stops spinning while we
  // call OpenAI; clear the inline keyboard from the question message.
  await ackAndClearKeyboard(
    cq,
    chatId,
    messageId,
    telegram,
    logger,
    "Recorded"
  );

  const chosen = consumed.options[parsed.optionIndex];
  const runner = new ConversationRunner(chatId, c.env, logger, telegram);
  try {
    await runner.resumeFromAnswer(
      consumed.messages as Parameters<typeof runner.resumeFromAnswer>[0],
      consumed.pendingToolCallId,
      chosen
    );
  } catch (error) {
    // The user's click was already acked above, so failing the webhook here
    // would cause Telegram to retry — which can't redeliver the click.
    // Log and continue.
    logger.error("dispatch resumed outcome failed", {
      callbackId: cq.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export { handleWebhook };
