import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  conversationSetMock,
  ENV,
  mockFetch,
  openaiCreateMock,
  pendingConsumeByChatIdMock,
  pendingSetMock,
  resetMessageMocks,
  sendRequest,
  validUpdate,
} from "./routes-test-helpers";

describe("POST /webhook/telegram", () => {
  beforeEach(() => {
    resetMessageMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
          chat_id: 12_345,
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
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      return;
    }
    const sentBody = JSON.parse((firstCall[1] as { body: string }).body) as {
      text: string;
      parse_mode: string;
    };
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
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      return;
    }
    const sentBody = JSON.parse(
      (firstCall[1] as { body: string }).body
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
});
