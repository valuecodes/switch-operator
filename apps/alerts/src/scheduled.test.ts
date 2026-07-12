import type { SendMessageParams } from "@repo/telegram/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleScheduled } from "./scheduled";

const sendMessage = vi.fn<(params: SendMessageParams) => Promise<unknown>>();

vi.mock("@repo/telegram", () => ({
  TelegramService: class {
    sendMessage = sendMessage;
  },
}));

const env = {
  TELEGRAM_BOT_TOKEN: "test-token",
  ALLOWED_CHAT_ID: "12345",
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

  it("sends the healthcheck message when its cron fires", async () => {
    await handleScheduled(makeEvent("0 8 * * *"), env, ctx);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const params = sendMessage.mock.calls[0][0];
    expect(params.chat_id).toBe(12345);
    expect(params.text).toContain("alerts worker healthy");
    expect(params.parse_mode).toBe("HTML");
  });

  it("does not send anything when no alert matches the fired cron", async () => {
    await handleScheduled(makeEvent("*/5 * * * *"), env, ctx);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
