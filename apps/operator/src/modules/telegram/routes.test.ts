import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  app,
  ENV,
  mockFetch,
  resetMessageMocks,
  sendRequest,
  TELEGRAM_IP,
  validUpdate,
} from "./routes-test-helpers";

describe("POST /webhook/telegram", () => {
  beforeEach(() => {
    resetMessageMocks();
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
          "cf-connecting-ip": TELEGRAM_IP,
          "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
        },
        body: "{invalid",
      },
      ENV
    );

    expect(res.status).toBe(400);
  });

  it("returns 401 before parsing malformed JSON when secret header is missing", async () => {
    const res = await app.request(
      "/webhook/telegram",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": TELEGRAM_IP,
        },
        body: "{invalid",
      },
      ENV
    );

    expect(res.status).toBe(401);
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
        chat: { id: 99_999, type: "private" },
      },
    };
    const res = await sendRequest(update, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 413 for oversized payloads", async () => {
    const { TELEGRAM_WEBHOOK_MAX_BODY_BYTES } = await import("./routes");
    const oversizedBody = JSON.stringify({
      ...validUpdate,
      message: {
        ...validUpdate.message,
        text: "x".repeat(TELEGRAM_WEBHOOK_MAX_BODY_BYTES),
      },
    });

    const res = await app.request(
      "/webhook/telegram",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(
            new TextEncoder().encode(oversizedBody).byteLength
          ),
          "cf-connecting-ip": TELEGRAM_IP,
          "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
        },
        body: oversizedBody,
      },
      ENV
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Payload too large" });
    expect(mockFetch).not.toHaveBeenCalled();
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
          chat: { id: 99_999, type: "private" },
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
