import type { Logger } from "@repo/logger";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramService } from "./telegram";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const createMockLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as Logger;

const createJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

describe("TelegramService", () => {
  const token = "test-bot-token";
  let service: TelegramService;

  beforeEach(() => {
    service = new TelegramService(token, createMockLogger());
    mockFetch.mockReset();
  });

  describe("sendMessage", () => {
    it("calls the correct URL with the correct body", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await service.sendMessage({ chat_id: 123, text: "hello" });

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: 123, text: "hello" }),
        }
      );
    });

    it("returns the parsed response", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({ ok: true, description: "sent" })
      );

      const result = await service.sendMessage({ chat_id: 123, text: "hi" });

      expect(result).toEqual({ ok: true, description: "sent" });
    });

    it("throws on invalid API response shape", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({ invalid: "response" })
      );

      await expect(
        service.sendMessage({ chat_id: 123, text: "hi" })
      ).rejects.toThrow();
    });

    it("throws on Telegram API error", async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({ ok: false, description: "Bad Request" })
      );

      await expect(
        service.sendMessage({ chat_id: 123, text: "hi" })
      ).rejects.toThrow("Telegram API error: Bad Request");
    });
  });

  describe("setWebhook", () => {
    it("calls the correct URL with the correct body", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await service.setWebhook("https://example.com/webhook", "my-secret");

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${token}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: "https://example.com/webhook",
            secret_token: "my-secret",
            allowed_updates: ["message", "callback_query"],
          }),
        }
      );
    });

    it("returns the parsed response", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      const result = await service.setWebhook("https://example.com/webhook");

      expect(result).toEqual({ ok: true });
    });
  });

  describe("answerCallbackQuery", () => {
    it("posts to /answerCallbackQuery with the given params", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await service.answerCallbackQuery({
        callback_query_id: "cb-1",
        text: "Done",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${token}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: "cb-1", text: "Done" }),
        }
      );
    });
  });

  describe("editMessageReplyMarkup", () => {
    it("posts to /editMessageReplyMarkup with chat and message ids", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await service.editMessageReplyMarkup({ chat_id: 1, message_id: 2 });

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${token}/editMessageReplyMarkup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: 1, message_id: 2 }),
        }
      );
    });
  });

  describe("sendMessage with reply_markup", () => {
    it("includes inline keyboard in the body", async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await service.sendMessage({
        chat_id: 1,
        text: "Confirm?",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Yes", callback_data: "c:t1" },
              { text: "No", callback_data: "x:t1" },
            ],
          ],
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: 1,
            text: "Confirm?",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Yes", callback_data: "c:t1" },
                  { text: "No", callback_data: "x:t1" },
                ],
              ],
            },
          }),
        }
      );
    });
  });
});
