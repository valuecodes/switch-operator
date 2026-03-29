import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../../types/env";
import { telegramUpdateSchema } from "../../types/telegram";
import { handleWebhook } from "./controller";

const telegramRoutes = new Hono<AppEnv>();
const TELEGRAM_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

const verifyTelegramSecret = createMiddleware<AppEnv>(async (c, next) => {
  const secret = c.req.header("x-telegram-bot-api-secret-token");

  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

const enforceTelegramBodyLimit = createMiddleware<AppEnv>(async (c, next) => {
  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader !== undefined) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (
      Number.isFinite(contentLength) &&
      contentLength > TELEGRAM_WEBHOOK_MAX_BODY_BYTES
    ) {
      return c.json({ error: "Payload too large" }, 413);
    }
  }

  const body = await c.req.text();
  if (
    new TextEncoder().encode(body).byteLength > TELEGRAM_WEBHOOK_MAX_BODY_BYTES
  ) {
    return c.json({ error: "Payload too large" }, 413);
  }

  await next();
});

telegramRoutes.post(
  "/webhook/telegram",
  verifyTelegramSecret,
  enforceTelegramBodyLimit,
  zValidator("json", telegramUpdateSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid payload" }, 400);
    }
  }),
  handleWebhook
);

export { TELEGRAM_WEBHOOK_MAX_BODY_BYTES, telegramRoutes };
