import type { Context } from "hono";

import { OpenAiService } from "../../services/openai";
import { TelegramService } from "../../services/telegram";
import type { AppEnv } from "../../types/env";
import type { TelegramUpdate } from "../../types/telegram";

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

  let reply: string;
  try {
    const openai = new OpenAiService(c.env.OPENAI_API_KEY, logger);
    reply = await openai.reply(message.text);
  } catch (error) {
    logger.error("openai request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    reply = "Something went wrong while generating a response. Please try again.";
  }

  await telegram.sendMessage({
    chat_id: chatId,
    text: reply,
  });

  return c.json({ ok: true });
};

export { handleWebhook };
