import { HttpClient } from "@repo/http-client";
import type { Logger } from "@repo/logger";

import type {
  AnswerCallbackQueryParams,
  EditMessageReplyMarkupParams,
  SendMessageParams,
} from "../types/telegram";
import { telegramApiResponseSchema } from "../types/telegram";

class TelegramService {
  private readonly client: HttpClient;

  constructor(token: string, logger: Logger) {
    this.client = new HttpClient({
      logger,
      baseUrl: `https://api.telegram.org/bot${token}`,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async request(method: string, body: Record<string, unknown>) {
    const result = await this.client.post(`/${method}`, {
      schema: telegramApiResponseSchema,
      body,
    });
    if (!result.ok) {
      throw new Error(
        `Telegram API error: ${result.description ?? "unknown error"}`
      );
    }
    return result;
  }

  async sendMessage(params: SendMessageParams) {
    return this.request("sendMessage", params);
  }

  async setWebhook(url: string, secretToken?: string) {
    return this.request("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    });
  }

  async answerCallbackQuery(params: AnswerCallbackQueryParams) {
    return this.request("answerCallbackQuery", params);
  }

  async editMessageReplyMarkup(params: EditMessageReplyMarkupParams) {
    return this.request("editMessageReplyMarkup", params);
  }
}

export { TelegramService };
