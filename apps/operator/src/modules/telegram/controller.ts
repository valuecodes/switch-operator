import type { Context } from "hono";

import { TelegramService } from "../../services/telegram";
import type { AppEnv } from "../../types/env";
import type { TelegramUpdate } from "../../types/telegram";

type WebhookInput = {
  in: { json: TelegramUpdate };
  out: { json: TelegramUpdate };
};

const handleWebhook = async (c: Context<AppEnv, string, WebhookInput>) => {
  const secret = c.req.header("x-telegram-bot-api-secret-token");
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const update = c.req.valid("json");
  const message = update.message;

  console.log("Incoming update:", JSON.stringify(update));
  console.log(
    "Chat ID:",
    message?.chat.id,
    "| Allowed:",
    c.env.ALLOWED_CHAT_ID
  );

  if (!message?.text) {
    return c.json({ ok: true });
  }

  const chatId = message.chat.id;
  console.log("Message:", message.text);

  if (String(chatId) !== c.env.ALLOWED_CHAT_ID) {
    console.log("Chat ID not allowed, ignoring");
    return c.json({ ok: true });
  }

  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN);
  await telegram.sendMessage({
    chat_id: chatId,
    text: message.text,
  });

  return c.json({ ok: true });
};

export { handleWebhook };
