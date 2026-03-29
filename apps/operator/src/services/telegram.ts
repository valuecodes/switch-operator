import { HttpClient } from "@repo/http-client";
import type { Logger } from "@repo/logger";

import type { SendMessageParams } from "../types/telegram";
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
    return this.request("setWebhook", { url, secret_token: secretToken });
  }
}

export { TelegramService };
