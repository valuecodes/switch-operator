import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openaiCreateMock = vi.fn().mockResolvedValue({
  choices: [{ message: { content: "AI response" } }],
});

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openaiCreateMock } };
  },
}));

const pendingGetMock = vi.fn();
const pendingClearMock = vi.fn();
const pendingSetMock = vi.fn();

vi.mock("../../services/pending-action", () => ({
  PendingActionService: class {
    get = pendingGetMock;
    clear = pendingClearMock;
    set = pendingSetMock;
  },
}));

import { onErrorHandler } from "../../middleware/error-handlers";
import { loggerMiddleware } from "../../middleware/logger";
import type { AppEnv } from "../../types/env";
import { TELEGRAM_WEBHOOK_MAX_BODY_BYTES, telegramRoutes } from "./routes";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const createMockD1 = () => {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: [], meta: {} }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    first: vi.fn().mockResolvedValue(null),
    raw: vi.fn().mockResolvedValue([]),
  };
  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn().mockResolvedValue({}),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as D1Database;
};

const ENV = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret-that-is-at-least-32-chars!",
  ALLOWED_CHAT_ID: "12345",
  OPENAI_API_KEY: "test-openai-key",
  DB: createMockD1(),
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

const TELEGRAM_IP = "149.154.167.50";

const sendRequest = (body: unknown, headers: Record<string, string> = {}) =>
  app.request(
    "/webhook/telegram",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": TELEGRAM_IP,
        ...headers,
      },
      body: JSON.stringify(body),
    },
    ENV
  );

describe("POST /webhook/telegram", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    ENV.DB = createMockD1();
    pendingGetMock.mockReset();
    pendingGetMock.mockResolvedValue(undefined);
    pendingClearMock.mockReset();
    pendingClearMock.mockResolvedValue(undefined);
    pendingSetMock.mockReset();
    pendingSetMock.mockResolvedValue(undefined);
    openaiCreateMock.mockResolvedValue({
      choices: [{ message: { content: "AI response" } }],
    });
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

  it("sends AI response as HTML with parse_mode", async () => {
    const res = await sendRequest(validUpdate, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: 12345,
          text: "AI response",
          parse_mode: "HTML",
        }),
      })
    );
  });

  it("converts markdown in AI response to HTML before sending", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "# Title\n\nThis is **bold** and `code`.",
          },
        },
      ],
    });

    const res = await sendRequest(validUpdate, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    const sentBody = JSON.parse(
      (mockFetch.mock.calls[0][1] as { body: string }).body
    ) as { text: string; parse_mode: string };
    expect(sentBody.parse_mode).toBe("HTML");
    expect(sentBody.text).toContain("<b>Title</b>");
    expect(sentBody.text).toContain("<b>bold</b>");
    expect(sentBody.text).toContain("<code>code</code>");
    expect(sentBody.text).not.toContain("# Title");
    expect(sentBody.text).not.toContain("**bold**");
  });

  it("sends error message as plain text when OpenAI fails", async () => {
    openaiCreateMock.mockRejectedValueOnce(
      new Error("401 insufficient permissions")
    );

    const res = await sendRequest(validUpdate, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const sentBody = JSON.parse(
      (mockFetch.mock.calls[0][1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty("parse_mode");
    expect(sentBody.text).toBe(
      "Something went wrong while generating a response. Please try again."
    );
  });

  it("sends 'Action cancelled.' as plain text without parse_mode", async () => {
    pendingGetMock.mockResolvedValueOnce({
      type: "create_schedule",
      payload: {},
      description: "test action",
    });

    const update = {
      ...validUpdate,
      message: { ...validUpdate.message, text: "no" },
    };

    const res = await sendRequest(update, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);
    const cancellationCall = mockFetch.mock.calls.find((call) => {
      const body = (call[1] as { body: string } | undefined)?.body;
      return typeof body === "string" && body.includes("Action cancelled.");
    });
    expect(cancellationCall).toBeDefined();
    if (!cancellationCall) {
      return;
    }
    const body = JSON.parse(
      (cancellationCall[1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("parse_mode");
    expect(body.text).toBe("Action cancelled.");
  });

  it("returns 413 for oversized payloads", async () => {
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
