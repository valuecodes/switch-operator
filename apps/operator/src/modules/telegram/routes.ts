import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "hono/utils/buffer";

import type { AppEnv } from "../../types/env";
import { telegramUpdateSchema } from "../../types/telegram";
import { handleWebhook } from "./controller";

const telegramRoutes = new Hono<AppEnv>();
const TELEGRAM_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

const verifyTelegramSecret = createMiddleware<AppEnv>(async (c, next) => {
  const secret = c.req.header("x-telegram-bot-api-secret-token");

  if (
    !secret ||
    !(await timingSafeEqual(secret, c.env.TELEGRAM_WEBHOOK_SECRET))
  ) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

telegramRoutes.post(
  "/webhook/telegram",
  verifyTelegramSecret,
  bodyLimit({
    maxSize: TELEGRAM_WEBHOOK_MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "Payload too large" }, 413),
  }),
  zValidator("json", telegramUpdateSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid payload" }, 400);
    }
  }),
  handleWebhook
);

export { TELEGRAM_WEBHOOK_MAX_BODY_BYTES, telegramRoutes };
