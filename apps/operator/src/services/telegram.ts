import type { SendMessageParams } from "../types/telegram";
import { telegramApiResponseSchema } from "../types/telegram";

const TELEGRAM_API_BASE = "https://api.telegram.org";

class TelegramService {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private buildUrl(method: string): string {
    return `${TELEGRAM_API_BASE}/bot${this.token}/${method}`;
  }

  private async request(method: string, body: Record<string, unknown>) {
    const response = await fetch(this.buildUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json();
    const result = telegramApiResponseSchema.parse(json);
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
