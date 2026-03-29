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

const telegramUpdateSchema = z
  .object({
    update_id: z.number(),
    message: telegramMessageSchema.optional(),
  })
  .loose();

const sendMessageParamsSchema = z.object({
  chat_id: z.number(),
  text: z.string(),
  parse_mode: z.enum(["HTML", "MarkdownV2"]).optional(),
});

const telegramApiResponseSchema = z
  .object({
    ok: z.boolean(),
    description: z.string().optional(),
  })
  .loose();

export {
  telegramUpdateSchema,
  telegramMessageSchema,
  sendMessageParamsSchema,
  telegramApiResponseSchema,
};

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type SendMessageParams = z.infer<typeof sendMessageParamsSchema>;
