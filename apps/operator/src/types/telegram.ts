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

const inlineKeyboardButtonSchema = z.object({
  text: z.string(),
  callback_data: z.string().max(64),
});

const inlineKeyboardMarkupSchema = z.object({
  inline_keyboard: z.array(z.array(inlineKeyboardButtonSchema)),
});

const sendMessageParamsSchema = z.object({
  chat_id: z.number(),
  text: z.string(),
  parse_mode: z.enum(["HTML", "MarkdownV2"]).optional(),
  reply_markup: inlineKeyboardMarkupSchema.optional(),
});

const answerCallbackQueryParamsSchema = z.object({
  callback_query_id: z.string(),
  text: z.string().optional(),
});

const editMessageReplyMarkupParamsSchema = z.object({
  chat_id: z.number(),
  message_id: z.number(),
});

const telegramApiResponseSchema = z
  .object({
    ok: z.boolean(),
    description: z.string().optional(),
  })
  .loose();

export {
  answerCallbackQueryParamsSchema,
  editMessageReplyMarkupParamsSchema,
  inlineKeyboardMarkupSchema,
  sendMessageParamsSchema,
  telegramApiResponseSchema,
  telegramCallbackQuerySchema,
  telegramMessageSchema,
  telegramUpdateSchema,
};

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramCallbackQuery = z.infer<typeof telegramCallbackQuerySchema>;
export type SendMessageParams = z.infer<typeof sendMessageParamsSchema>;
export type AnswerCallbackQueryParams = z.infer<
  typeof answerCallbackQueryParamsSchema
>;
export type EditMessageReplyMarkupParams = z.infer<
  typeof editMessageReplyMarkupParamsSchema
>;
export type InlineKeyboardMarkup = z.infer<typeof inlineKeyboardMarkupSchema>;
