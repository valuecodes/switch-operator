import { z } from "zod";

const telegramChatSchema = z.object({
  id: z.number(),
  type: z.string(),
});

const telegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
});

const telegramMessageSchema = z
  .object({
    message_id: z.number(),
    from: telegramUserSchema.optional(),
    chat: telegramChatSchema,
    date: z.number(),
    text: z.string().optional(),
  })
  .loose();

// `message` is optional because Telegram may deliver an "inaccessible
// message" stub for very old buttons; keys we don't use are also tolerated.
const telegramCallbackQuerySchema = z
  .object({
    id: z.string(),
    from: telegramUserSchema,
    message: telegramMessageSchema.optional(),
    data: z.string().optional(),
  })
  .loose();

const telegramUpdateSchema = z
  .object({
    update_id: z.number(),
    message: telegramMessageSchema.optional(),
    callback_query: telegramCallbackQuerySchema.optional(),
  })
  .loose();

type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
type TelegramCallbackQuery = z.infer<typeof telegramCallbackQuerySchema>;

export { telegramUpdateSchema };
export type { TelegramCallbackQuery, TelegramUpdate };
