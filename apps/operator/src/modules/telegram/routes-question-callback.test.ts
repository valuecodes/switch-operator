import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callbackUpdate,
  conversationConsumeByTokenMock,
  conversationGetByTokenMock,
  ENV,
  mockFetch,
  openaiCreateMock,
  resetCallbackMocks,
  sendRequest,
} from "./routes-test-helpers";

describe("POST /webhook/telegram — callback_query", () => {
  const headers = {
    "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET,
  };

  beforeEach(() => {
    resetCallbackMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      expect(conversationGetByTokenMock).toHaveBeenCalledWith(12_345, "tok-x");
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
        12_345,
        "tok-r"
      );

      // The OpenAI call should have received messages with a tool result that
      // carries the raw boolean (NOT a string).
      const openaiCall = openaiCreateMock.mock.calls.at(-1) as
        [{ messages: { role: string; content?: string }[] }] | undefined;
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
