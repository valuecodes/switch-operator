// Shared setup for the telegram route test files. Importing this module
// registers the module mocks below, so it must be imported before anything
// that pulls in the route/controller graph.
import { Hono } from "hono";
import { vi } from "vitest";

import { onErrorHandler } from "~/middleware/error-handlers";
import { loggerMiddleware } from "~/middleware/logger";
import type { AppEnv } from "~/types/env";

import { telegramRoutes } from "./routes";

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

vi.mock("~/services/pending-action", () => ({
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

vi.mock("~/services/pending-conversation", () => ({
  PendingConversationService: class {
    getByToken = conversationGetByTokenMock;
    consumeByToken = conversationConsumeByTokenMock;
    set = conversationSetMock;
    clear = conversationClearMock;
  },
}));

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
    chat: { id: 12_345, type: "private" },
    date: 1_234_567_890,
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
      from: { id: overrides.fromId ?? 12_345, is_bot: false, first_name: "U" },
      data: overrides.data ?? "c:tok123",
      ...(includeMessage
        ? {
            message: {
              message_id: overrides.messageId ?? 99,
              chat: { id: overrides.chatId ?? 12_345, type: "private" },
              date: 1_234_567_890,
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

const fetchedMethods = (): string[] =>
  mockFetch.mock.calls.map((call) => {
    const url = call[0] as string;
    return url.split("/").pop() ?? "";
  });

const mockFetchOk = () => {
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    )
  );
};

const resetPendingActionMocks = () => {
  pendingConsumeByChatIdMock.mockReset();
  pendingConsumeByChatIdMock.mockResolvedValue(undefined);
  pendingConsumeByTokenMock.mockReset();
  pendingConsumeByTokenMock.mockResolvedValue(undefined);
  pendingClearMock.mockReset();
  pendingClearMock.mockResolvedValue(undefined);
  pendingSetMock.mockReset();
  pendingSetMock.mockResolvedValue("tok-default");
};

// Per-test reset for the plain-message webhook tests.
const resetMessageMocks = () => {
  mockFetch.mockReset();
  ENV.DB = createMockD1();
  resetPendingActionMocks();
  openaiCreateMock.mockResolvedValue({
    choices: [{ message: { content: "AI response" } }],
  });
  mockFetchOk();
};

// Per-test reset for the callback_query webhook tests.
const resetCallbackMocks = () => {
  mockFetch.mockReset();
  ENV.DB = createMockD1();
  resetPendingActionMocks();
  conversationGetByTokenMock.mockReset();
  conversationGetByTokenMock.mockResolvedValue(undefined);
  conversationConsumeByTokenMock.mockReset();
  conversationConsumeByTokenMock.mockResolvedValue(undefined);
  conversationSetMock.mockReset();
  conversationSetMock.mockResolvedValue("conv-tok");
  conversationClearMock.mockReset();
  conversationClearMock.mockResolvedValue(undefined);
  mockFetchOk();
};

export {
  app,
  callbackUpdate,
  conversationConsumeByTokenMock,
  conversationGetByTokenMock,
  conversationSetMock,
  ENV,
  fetchedMethods,
  mockFetch,
  openaiCreateMock,
  pendingConsumeByChatIdMock,
  pendingConsumeByTokenMock,
  pendingSetMock,
  resetCallbackMocks,
  resetMessageMocks,
  sendRequest,
  TELEGRAM_IP,
  validUpdate,
};
