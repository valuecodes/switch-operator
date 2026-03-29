import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramService } from "./telegram";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const createJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

describe("TelegramService", () => {
  const token = "test-bot-token";
  let service: TelegramService;

  beforeEach(() => {
    service = new TelegramService(token);
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
});
