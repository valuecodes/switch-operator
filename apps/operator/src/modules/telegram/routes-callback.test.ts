import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callbackUpdate,
  ENV,
  fetchedMethods,
  mockFetch,
  pendingConsumeByTokenMock,
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

  it("ignores callback_query from disallowed user", async () => {
    const res = await sendRequest(
      callbackUpdate({ fromId: 99_999, data: "c:tok-x" }),
      headers
    );

    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(pendingConsumeByTokenMock).not.toHaveBeenCalled();
  });

  it("ignores callback_query from disallowed chat", async () => {
    const res = await sendRequest(
      callbackUpdate({ chatId: 99_999, data: "c:tok-x" }),
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
    expect(pendingConsumeByTokenMock).toHaveBeenCalledWith(12_345, "tok-1");
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
    const { ScheduleService } = await import("~/services/schedule");
    vi.spyOn(ScheduleService.prototype, "remove").mockImplementation(
      removeMock
    );

    const res = await sendRequest(callbackUpdate({ data: "c:tok-1" }), headers);

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith("abc", 12_345);
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
    const { ScheduleService } = await import("~/services/schedule");
    vi.spyOn(ScheduleService.prototype, "remove").mockImplementation(
      removeMock
    );

    await sendRequest(callbackUpdate({ data: "c:tok-1" }), headers);
    await sendRequest(callbackUpdate({ data: "c:tok-1" }), headers);

    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});
