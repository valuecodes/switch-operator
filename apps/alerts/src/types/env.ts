import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_CHAT_ID: z.string().min(1),
});

type Env = z.infer<typeof envSchema>;

const parseEnv = (env: unknown): Env => {
  return envSchema.parse(env);
};

export { envSchema, parseEnv };
export type { Env };
