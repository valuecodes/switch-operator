import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../types/env";
import { envSchema } from "../types/env";

const envValidatorMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const result = envSchema.safeParse(c.env);
  if (!result.success) {
    c.get("logger").error("invalid environment", {
      error: result.error.message,
    });
    return c.json({ error: "Server misconfiguration" }, 500);
  }
  await next();
});

export { envValidatorMiddleware };
