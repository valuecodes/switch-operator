import { z } from "zod";

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
};

export type SendMessageParams = z.infer<typeof sendMessageParamsSchema>;
export type AnswerCallbackQueryParams = z.infer<
  typeof answerCallbackQueryParamsSchema
>;
export type EditMessageReplyMarkupParams = z.infer<
  typeof editMessageReplyMarkupParamsSchema
>;
export type InlineKeyboardMarkup = z.infer<typeof inlineKeyboardMarkupSchema>;
