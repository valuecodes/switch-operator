import type { Logger } from "@repo/logger";
import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32),
  ALLOWED_CHAT_ID: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
});

type AppEnv = {
  Bindings: z.infer<typeof envSchema> & {
    DB: D1Database;
    BROWSER_SCRAPER: Fetcher;
  };
  Variables: {
    logger: Logger;
    requestId: string;
  };
};

export { envSchema };
export type { AppEnv };
