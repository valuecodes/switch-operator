import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import type { AppEnv } from "../../types/env";
import { telegramUpdateSchema } from "../../types/telegram";
import { handleWebhook } from "./controller";

const telegramRoutes = new Hono<AppEnv>();

telegramRoutes.post(
  "/webhook/telegram",
  zValidator("json", telegramUpdateSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid payload" }, 400);
    }
  }),
  handleWebhook
);

export { telegramRoutes };
