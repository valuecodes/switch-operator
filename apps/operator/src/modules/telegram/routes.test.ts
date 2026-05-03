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

const pendingConsumeByChatIdMock = vi.fn();
const pendingConsumeByTokenMock = vi.fn();
const pendingClearMock = vi.fn();
const pendingSetMock = vi.fn();

vi.mock("../../services/pending-action", () => ({
  PendingActionService: class {
    consumeByChatId = pendingConsumeByChatIdMock;
    consumeByToken = pendingConsumeByTokenMock;
    clear = pendingClearMock;
    set = pendingSetMock;
  },
  generateToken: () => "tok-fake",
}));

const conversationGetByTokenMock = vi.fn();
const conversationConsumeByTokenMock = vi.fn();
const conversationSetMock = vi.fn();
const conversationClearMock = vi.fn();

vi.mock("../../services/pending-conversation", () => ({
  PendingConversationService: class {
    getByToken = conversationGetByTokenMock;
    consumeByToken = conversationConsumeByTokenMock;
    set = conversationSetMock;
    clear = conversationClearMock;
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

const callbackUpdate = (overrides: {
  data?: string;
  fromId?: number;
  chatId?: number;
  messageId?: number;
  includeMessage?: boolean;
}) => {
  const includeMessage = overrides.includeMessage ?? true;
  return {
    update_id: 2,
    callback_query: {
      id: "cb-1",
      from: { id: overrides.fromId ?? 12345, is_bot: false, first_name: "U" },
      data: overrides.data ?? "c:tok123",
      ...(includeMessage
        ? {
            message: {
              message_id: overrides.messageId ?? 99,
              chat: { id: overrides.chatId ?? 12345, type: "private" },
              date: 1234567890,
            },
          }
        : {}),
    },
  };
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
    pendingConsumeByChatIdMock.mockReset();
    pendingConsumeByChatIdMock.mockResolvedValue(undefined);
    pendingConsumeByTokenMock.mockReset();
    pendingConsumeByTokenMock.mockResolvedValue(undefined);
    pendingClearMock.mockReset();
    pendingClearMock.mockResolvedValue(undefined);
    pendingSetMock.mockReset();
    pendingSetMock.mockResolvedValue("tok-default");
    openaiCreateMock.mockResolvedValue({
      choices: [{ message: { content: "AI response" } }],
    });
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        })
      )
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

  it("nudges the model to ask first when create_schedule omits use_browser for a monitor", async () => {
    openaiCreateMock.mockClear();
    // First turn: model emits create_schedule with source_url but no use_browser.
    openaiCreateMock.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_create_1",
                type: "function",
                function: {
                  name: "create_schedule",
                  arguments: JSON.stringify({
                    schedule_type: "daily",
                    hour: 9,
                    minute: 0,
                    timezone: "Europe/Helsinki",
                    source_url: "https://twitter.com/elonmusk",
                    message_prompt: "Check for new posts",
                    description: "Monitor Twitter",
                  }),
                },
              },
            ],
          },
        },
      ],
    });
    // Second turn: model corrects and asks the question.
    openaiCreateMock.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_q_1",
                type: "function",
                function: {
                  name: "ask_user_question",
                  arguments: JSON.stringify({
                    question:
                      "Should I use the browser scraper for this page (renders JavaScript)?",
                    options: [
                      { label: "Yes — needs JS rendering", value: true },
                      { label: "No — static HTML", value: false },
                    ],
                  }),
                },
              },
            ],
          },
        },
      ],
    });
    conversationSetMock.mockResolvedValueOnce("conv-tok-1");

    const update = {
      ...validUpdate,
      message: { ...validUpdate.message, text: "monitor twitter.com" },
    };
    const res = await sendRequest(update, {
      "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
    });

    expect(res.status).toBe(200);

    // The second OpenAI call must include the guard error as the tool result
    // for the rejected create_schedule call.
    const secondCall = openaiCreateMock.mock.calls[1] as
      | [
          {
            messages: {
              role: string;
              tool_call_id?: string;
              content?: string;
            }[];
          },
        ]
      | undefined;
    expect(secondCall).toBeDefined();
    if (!secondCall) {
      return;
    }
    const toolMessage = secondCall[0].messages.find(
      (m) => m.role === "tool" && m.tool_call_id === "call_create_1"
    );
    expect(toolMessage?.content).toContain("use_browser");
    expect(toolMessage?.content).toContain("ask_user_question");

    // No schedule was committed — pendingActions.set was not invoked.
    expect(pendingSetMock).not.toHaveBeenCalled();

    // Question was dispatched to the user with inline buttons.
    expect(conversationSetMock).toHaveBeenCalledTimes(1);
    const sendCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("/sendMessage")
    );
    expect(sendCall).toBeDefined();
    if (!sendCall) {
      return;
    }
    const sendBody = JSON.parse(
      (sendCall[1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(sendBody.reply_markup).toBeDefined();
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

  it("sends 'Action cancelled.' as plain text without parse_mode for typed non-YES reply", async () => {
    pendingConsumeByChatIdMock.mockResolvedValueOnce({
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

describe("POST /webhook/telegram — callback_query", () => {
  const headers = {
    "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
  };

  beforeEach(() => {
    mockFetch.mockReset();
    ENV.DB = createMockD1();
    pendingConsumeByChatIdMock.mockReset();
    pendingConsumeByChatIdMock.mockResolvedValue(undefined);
    pendingConsumeByTokenMock.mockReset();
    pendingConsumeByTokenMock.mockResolvedValue(undefined);
    pendingClearMock.mockReset();
    pendingClearMock.mockResolvedValue(undefined);
    pendingSetMock.mockReset();
    pendingSetMock.mockResolvedValue("tok-default");
    conversationGetByTokenMock.mockReset();
    conversationGetByTokenMock.mockResolvedValue(undefined);
    conversationConsumeByTokenMock.mockReset();
    conversationConsumeByTokenMock.mockResolvedValue(undefined);
    conversationSetMock.mockReset();
    conversationSetMock.mockResolvedValue("conv-tok");
    conversationClearMock.mockReset();
    conversationClearMock.mockResolvedValue(undefined);
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fetchedMethods = (): string[] =>
    mockFetch.mock.calls.map((call) => {
      const url = call[0] as string;
      return url.split("/").pop() ?? "";
    });

  it("ignores callback_query from disallowed user", async () => {
    const res = await sendRequest(
      callbackUpdate({ fromId: 99999, data: "c:tok-x" }),
      headers
    );

    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(pendingConsumeByTokenMock).not.toHaveBeenCalled();
  });

  it("ignores callback_query from disallowed chat", async () => {
    const res = await sendRequest(
      callbackUpdate({ chatId: 99999, data: "c:tok-x" }),
      headers
    );

    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(pendingConsumeByTokenMock).not.toHaveBeenCalled();
  });

  it("acks but does nothing when callback has no message field", async () => {
    const res = await sendRequest(
      callbackUpdate({ includeMessage: false, data: "c:tok-x" }),
      headers
    );

    expect(res.status).toBe(200);
    expect(pendingConsumeByTokenMock).not.toHaveBeenCalled();
    expect(fetchedMethods()).toContain("answerCallbackQuery");
    expect(fetchedMethods()).not.toContain("editMessageReplyMarkup");
    expect(fetchedMethods()).not.toContain("sendMessage");
  });

  it("acks and ignores malformed callback_data", async () => {
    const res = await sendRequest(callbackUpdate({ data: "garbage" }), headers);

    expect(res.status).toBe(200);
    expect(pendingConsumeByTokenMock).not.toHaveBeenCalled();
    expect(fetchedMethods()).toContain("answerCallbackQuery");
  });

  it("expired/unknown token: acks with toast and clears buttons, no execution", async () => {
    pendingConsumeByTokenMock.mockResolvedValueOnce(undefined);

    const res = await sendRequest(
      callbackUpdate({ data: "c:tok-stale" }),
      headers
    );

    expect(res.status).toBe(200);
    const ackCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
    );
    expect(ackCall).toBeDefined();
    if (!ackCall) {
      return;
    }
    const ackBody = JSON.parse((ackCall[1] as { body: string }).body) as Record<
      string,
      unknown
    >;
    expect(ackBody.text).toBe("Expired or already used");

    const editCall = mockFetch.mock.calls.find(
      (c) =>
        typeof c[0] === "string" && c[0].endsWith("/editMessageReplyMarkup")
    );
    expect(editCall).toBeDefined();
    const sendCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("/sendMessage")
    );
    expect(sendCall).toBeUndefined();
  });

  it("cancel: acks with 'Cancelled', clears buttons, no execution", async () => {
    pendingConsumeByTokenMock.mockResolvedValueOnce({
      type: "create_schedule",
      payload: {},
      description: "any",
    });

    const res = await sendRequest(callbackUpdate({ data: "x:tok-1" }), headers);

    expect(res.status).toBe(200);
    expect(pendingConsumeByTokenMock).toHaveBeenCalledWith(12345, "tok-1");
    const ackCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
    );
    expect(ackCall).toBeDefined();
    if (!ackCall) {
      return;
    }
    const ackBody = JSON.parse((ackCall[1] as { body: string }).body) as Record<
      string,
      unknown
    >;
    expect(ackBody.text).toBe("Cancelled");
    const sendCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("/sendMessage")
    );
    expect(sendCall).toBeUndefined();
  });

  it("confirm delete: acks 'Schedule deleted' and sends result message", async () => {
    pendingConsumeByTokenMock.mockResolvedValueOnce({
      type: "delete_schedule",
      payload: { id: "abc" },
      description: "Delete schedule abc",
    });
    const removeMock = vi.fn().mockResolvedValue(true);
    const { ScheduleService } = await import("../../services/schedule");
    vi.spyOn(ScheduleService.prototype, "remove").mockImplementation(
      removeMock
    );

    const res = await sendRequest(callbackUpdate({ data: "c:tok-1" }), headers);

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith("abc", 12345);
    const ackCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
    );
    expect(ackCall).toBeDefined();
    if (!ackCall) {
      return;
    }
    const ackBody = JSON.parse((ackCall[1] as { body: string }).body) as Record<
      string,
      unknown
    >;
    expect(ackBody.text).toBe("Schedule deleted");
    const sendCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("/sendMessage")
    );
    expect(sendCall).toBeDefined();
  });

  it("double-tap: second consumeByToken returns undefined → no double execution", async () => {
    pendingConsumeByTokenMock
      .mockResolvedValueOnce({
        type: "delete_schedule",
        payload: { id: "abc" },
        description: "Delete schedule abc",
      })
      .mockResolvedValueOnce(undefined);
    const removeMock = vi.fn().mockResolvedValue(true);
    const { ScheduleService } = await import("../../services/schedule");
    vi.spyOn(ScheduleService.prototype, "remove").mockImplementation(
      removeMock
    );

    await sendRequest(callbackUpdate({ data: "c:tok-1" }), headers);
    await sendRequest(callbackUpdate({ data: "c:tok-1" }), headers);

    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  describe("question-answer callback (q:<token>:<index>)", () => {
    it("acks 'Malformed' for non-numeric option index", async () => {
      const res = await sendRequest(
        callbackUpdate({ data: "q:tok-1:abc" }),
        headers
      );

      expect(res.status).toBe(200);
      expect(conversationConsumeByTokenMock).not.toHaveBeenCalled();
      const ackCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
      );
      expect(ackCall).toBeDefined();
      if (!ackCall) {
        return;
      }
      const ackBody = JSON.parse(
        (ackCall[1] as { body: string }).body
      ) as Record<string, unknown>;
      expect(ackBody.text).toBe("Malformed");
    });

    it("acks 'Expired or already used' when conversation token is unknown", async () => {
      conversationGetByTokenMock.mockResolvedValueOnce(undefined);

      const res = await sendRequest(
        callbackUpdate({ data: "q:tok-x:0" }),
        headers
      );

      expect(res.status).toBe(200);
      expect(conversationGetByTokenMock).toHaveBeenCalledWith(12345, "tok-x");
      // Out-of-range/unknown tokens must not consume the row.
      expect(conversationConsumeByTokenMock).not.toHaveBeenCalled();
      const ackCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
      );
      expect(ackCall).toBeDefined();
      if (!ackCall) {
        return;
      }
      const ackBody = JSON.parse(
        (ackCall[1] as { body: string }).body
      ) as Record<string, unknown>;
      expect(ackBody.text).toBe("Expired or already used");
    });

    it("acks 'Invalid option' when index is out of range and preserves pending state", async () => {
      conversationGetByTokenMock.mockResolvedValueOnce({
        messages: [],
        pendingToolCallId: "call_q",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      });

      const res = await sendRequest(
        callbackUpdate({ data: "q:tok-r:9" }),
        headers
      );

      expect(res.status).toBe(200);
      // The pending row must remain intact so a tampered/malformed callback
      // can't strand the user with no way to retry from the real buttons.
      expect(conversationConsumeByTokenMock).not.toHaveBeenCalled();
      const ackCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
      );
      expect(ackCall).toBeDefined();
      if (!ackCall) {
        return;
      }
      const ackBody = JSON.parse(
        (ackCall[1] as { body: string }).body
      ) as Record<string, unknown>;
      expect(ackBody.text).toBe("Invalid option");
    });

    it("acks 'Something went wrong' when peek throws", async () => {
      conversationGetByTokenMock.mockRejectedValueOnce(new Error("db down"));

      const res = await sendRequest(
        callbackUpdate({ data: "q:tok-r:0" }),
        headers
      );

      expect(res.status).toBe(200);
      const ackCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
      );
      expect(ackCall).toBeDefined();
      if (!ackCall) {
        return;
      }
      const ackBody = JSON.parse(
        (ackCall[1] as { body: string }).body
      ) as Record<string, unknown>;
      expect(ackBody.text).toBe("Something went wrong");
    });

    it("happy path: appends tool result with raw boolean value and resumes", async () => {
      const stored = {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "monitor twitter.com" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_q",
                type: "function",
                function: {
                  name: "ask_user_question",
                  arguments: JSON.stringify({
                    question: "Use browser?",
                    options: [
                      { label: "Yes", value: true },
                      { label: "No", value: false },
                    ],
                  }),
                },
              },
            ],
          },
        ],
        pendingToolCallId: "call_q",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      };
      conversationGetByTokenMock.mockResolvedValueOnce(stored);
      conversationConsumeByTokenMock.mockResolvedValueOnce(stored);

      // OpenAI returns a final answer on resume.
      openaiCreateMock.mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "Got it." },
          },
        ],
      });

      const res = await sendRequest(
        callbackUpdate({ data: "q:tok-r:0" }),
        headers
      );

      expect(res.status).toBe(200);
      expect(conversationConsumeByTokenMock).toHaveBeenCalledWith(
        12345,
        "tok-r"
      );

      // The OpenAI call should have received messages with a tool result that
      // carries the raw boolean (NOT a string).
      const openaiCall = openaiCreateMock.mock.calls.at(-1) as
        | [{ messages: { role: string; content?: string }[] }]
        | undefined;
      expect(openaiCall).toBeDefined();
      if (!openaiCall) {
        return;
      }
      const sentMessages = openaiCall[0].messages;
      const toolResult = sentMessages.find((m) => m.role === "tool");
      expect(toolResult).toBeDefined();
      expect(toolResult?.content).toBe(
        JSON.stringify({ value: true, label: "Yes" })
      );

      // The bot then sends the LLM's final reply.
      const sendCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].endsWith("/sendMessage")
      );
      expect(sendCall).toBeDefined();
    });

    it("ack toast says 'Recorded' on happy path", async () => {
      const stored = {
        messages: [{ role: "system", content: "sys" }],
        pendingToolCallId: "call_q",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      };
      conversationGetByTokenMock.mockResolvedValueOnce(stored);
      conversationConsumeByTokenMock.mockResolvedValueOnce(stored);
      openaiCreateMock.mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "ok" },
          },
        ],
      });

      await sendRequest(callbackUpdate({ data: "q:tok-r:1" }), headers);

      const ackCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].endsWith("/answerCallbackQuery")
      );
      expect(ackCall).toBeDefined();
      if (!ackCall) {
        return;
      }
      const ackBody = JSON.parse(
        (ackCall[1] as { body: string }).body
      ) as Record<string, unknown>;
      expect(ackBody.text).toBe("Recorded");
    });
  });
});
