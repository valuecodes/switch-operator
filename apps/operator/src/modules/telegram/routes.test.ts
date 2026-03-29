import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onErrorHandler } from "../../middleware/error-handlers";
import { loggerMiddleware } from "../../middleware/logger";
import type { AppEnv } from "../../types/env";
import { telegramRoutes } from "./routes";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const ENV = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  ALLOWED_CHAT_ID: "12345",
};

const validUpdate = {
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: 12345, type: "private" },
    date: 1234567890,
    text: "hello",
  },
};

const app = new Hono<AppEnv>();
app.use("*", loggerMiddleware);
app.onError(onErrorHandler);
app.route("/", telegramRoutes);

const sendRequest = (body: unknown, headers: Record<string, string> = {}) =>
  app.request(
    "/webhook/telegram",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
    ENV
  );

describe("POST /webhook/telegram", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid payload", async () => {
    const res = await sendRequest(
      { invalid: true },
      {
        "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
      }
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await app.request(
      "/webhook/telegram",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
        },
        body: "{invalid",
      },
      ENV
    );

    expect(res.status).toBe(400);
  });

  it("returns 401 when secret header is missing", async () => {
    const res = await sendRequest(validUpdate);

    expect(res.status).toBe(401);
  });

  it("returns 401 when secret header is wrong", async () => {
    const res = await sendRequest(validUpdate, {
      "x-telegram-bot-api-secret-token": "wrong-secret",
    });

    expect(res.status).toBe(401);
  });

  it("returns ok for update without text message", async () => {
    const update = { update_id: 1 };
    const res = await sendRequest(update, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns ok for disallowed chat ID without sending message", async () => {
    const update = {
      ...validUpdate,
      message: {
        ...validUpdate.message,
        chat: { id: 99999, type: "private" },
      },
    };
    const res = await sendRequest(update, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("echoes message back for valid request", async () => {
    const res = await sendRequest(validUpdate, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chat_id: 12345, text: "hello" }),
      })
    );
  });

  it("avoids logging message content or chat identifiers", async () => {
    const debugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const res = await sendRequest(validUpdate, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);

    const output = [
      ...debugSpy.mock.calls,
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .map(([entry]) => String(entry))
      .join("\n");

    expect(output).not.toContain('"update":');
    expect(output).not.toContain('"allowedChatId":');
    expect(output).not.toContain('"chatId":12345');
    expect(output).not.toContain('"text":"hello"');
  });

  it("avoids logging disallowed chat identifiers", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const res = await sendRequest(
      {
        ...validUpdate,
        message: {
          ...validUpdate.message,
          chat: { id: 99999, type: "private" },
        },
      },
      {
        "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
      }
    );

    expect(res.status).toBe(200);

    const output = warnSpy.mock.calls
      .map(([entry]) => String(entry))
      .join("\n");
    expect(output).not.toContain("99999");
  });
});
