import type { SendMessageParams } from "@repo/telegram/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleScheduled } from "./scheduled";

const sendMessage = vi.fn<(params: SendMessageParams) => Promise<unknown>>();

vi.mock("@repo/telegram", () => ({
  TelegramService: class {
    sendMessage = sendMessage;
  },
}));

vi.mock("@repo/alpha-vantage", () => ({
  AlphaVantageClient: class {
    getDailyTimeSeries = () =>
      Promise.resolve({
        symbol: "SPY",
        lastRefreshed: "2024-01-05",
        timeZone: "US/Eastern",
        bars: [
          {
            date: "2024-01-05",
            open: 468.3,
            high: 469.13,
            low: 464.45,
            close: 467.28,
            volume: 92955850,
          },
        ],
      });
  },
}));

const env = {
  TELEGRAM_BOT_TOKEN: "test-token",
  ALLOWED_CHAT_ID: "12345",
  ALPHA_VANTAGE_API_KEY: "test-key",
};

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

const makeEvent = (cron: string): ScheduledEvent =>
  ({ cron, scheduledTime: 0 }) as unknown as ScheduledEvent;

describe("handleScheduled", () => {
  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ ok: true });
  });

  it("sends the alert messages when the daily cron fires", async () => {
    await handleScheduled(makeEvent("0 8 * * *"), env, ctx);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const texts = sendMessage.mock.calls.map(([params]) => params.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("alerts worker healthy"),
        expect.stringContaining("SPY close 2024-01-05"),
      ])
    );
    for (const [params] of sendMessage.mock.calls) {
      expect(params.chat_id).toBe(12345);
      expect(params.parse_mode).toBe("HTML");
    }
  });

  it("does not send anything when no alert matches the fired cron", async () => {
    await handleScheduled(makeEvent("*/5 * * * *"), env, ctx);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
