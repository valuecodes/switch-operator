import type { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildInitialMessages, OpenAiService } from "./openai";
import type { ToolExecutor, ToolLoopMessages } from "./openai";

const createMock = vi.fn();
const constructorMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
    constructor(options: Record<string, unknown>) {
      constructorMock(options);
    }
  },
}));

const createMockLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as Logger;

const priorAnswer = (id: string): unknown => ({
  role: "tool",
  tool_call_id: id,
  content: JSON.stringify({ value: true, label: "Yes" }),
});

describe("OpenAiService.runToolLoop", () => {
  let service: OpenAiService;

  beforeEach(() => {
    service = new OpenAiService("test-api-key", createMockLogger());
    createMock.mockReset();
    constructorMock.mockReset();
  });

  const validQuestionArgs = JSON.stringify({
    question: "Use browser rendering?",
    options: [
      { label: "Yes — needs JS", value: true },
      { label: "No — static HTML", value: false },
    ],
  });

  it("returns ask_user_question outcome when the model emits the tool", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_q1",
                type: "function",
                function: {
                  name: "ask_user_question",
                  arguments: validQuestionArgs,
                },
              },
            ],
          },
        },
      ],
    });

    const executor: ToolExecutor = vi.fn();
    const messages = buildInitialMessages("monitor twitter.com");
    const outcome = await service.runToolLoop(messages, executor);

    expect(outcome.kind).toBe("ask_user_question");
    if (outcome.kind !== "ask_user_question") {
      throw new Error("expected ask_user_question outcome");
    }
    expect(outcome.toolCallId).toBe("call_q1");
    expect(outcome.question).toBe("Use browser rendering?");
    expect(outcome.options).toHaveLength(2);
    expect(outcome.options[0]?.value).toBe(true);
    expect(outcome.options[1]?.value).toBe(false);
    // The paused outcome contains the assistant turn but no tool result yet
    // for the question's tool_call_id.
    expect(executor).not.toHaveBeenCalled();
    const lastMsg = outcome.messages.at(-1);
    expect(lastMsg?.role).toBe("assistant");
    const toolResultsForQuestion = outcome.messages.filter(
      (m) =>
        m.role === "tool" &&
        (m as { tool_call_id?: string }).tool_call_id === "call_q1"
    );
    expect(toolResultsForQuestion).toHaveLength(0);
  });

  it("processes sibling tool calls before suspending on ask_user_question", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_list",
                type: "function",
                function: { name: "list_schedules", arguments: "{}" },
              },
              {
                id: "call_q",
                type: "function",
                function: {
                  name: "ask_user_question",
                  arguments: validQuestionArgs,
                },
              },
            ],
          },
        },
      ],
    });

    const executor: ToolExecutor = vi
      .fn()
      .mockResolvedValueOnce({ result: "[]" });

    const messages = buildInitialMessages("test");
    const outcome = await service.runToolLoop(messages, executor);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith("list_schedules", {});
    expect(outcome.kind).toBe("ask_user_question");
    // Sibling's tool result is in messages so the assistant turn is satisfiable
    // on resume.
    const siblingResult = outcome.messages.find(
      (m) =>
        m.role === "tool" &&
        (m as { tool_call_id?: string }).tool_call_id === "call_list"
    );
    expect(siblingResult).toBeDefined();
  });

  it("rejects mutating sibling tool calls when ask_user_question is in the same batch", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_create",
                type: "function",
                function: {
                  name: "create_schedule",
                  arguments: "{}",
                },
              },
              {
                id: "call_q",
                type: "function",
                function: {
                  name: "ask_user_question",
                  arguments: validQuestionArgs,
                },
              },
            ],
          },
        },
      ],
    });

    const executor: ToolExecutor = vi.fn();
    const messages = buildInitialMessages("monitor twitter.com");
    const outcome = await service.runToolLoop(messages, executor);

    // Mutating sibling must NOT execute; the model gets a tool error so
    // it can retry on the next turn (after the user answers).
    expect(executor).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("ask_user_question");
    const rejection = outcome.messages.find(
      (m) =>
        m.role === "tool" &&
        (m as { tool_call_id?: string }).tool_call_id === "call_create"
    ) as { content?: string } | undefined;
    expect(rejection?.content).toContain("create_schedule");
    expect(rejection?.content).toContain("ask_user_question");
  });

  it("denies the 4th ask_user_question and continues to final", async () => {
    const priorAskTurn = (id: string): unknown => ({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: {
            name: "ask_user_question",
            arguments: validQuestionArgs,
          },
        },
      ],
    });

    const messages = [
      ...buildInitialMessages("test"),
      priorAskTurn("p1"),
      priorAnswer("p1"),
      priorAskTurn("p2"),
      priorAnswer("p2"),
      priorAskTurn("p3"),
      priorAnswer("p3"),
    ] as ToolLoopMessages;

    // Model tries to ask a 4th question; loop denies, then on next round
    // model returns a final answer.
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_q4",
                  type: "function",
                  function: {
                    name: "ask_user_question",
                    arguments: validQuestionArgs,
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "Done." },
          },
        ],
      });

    const executor: ToolExecutor = vi.fn();
    const outcome = await service.runToolLoop(messages, executor);

    expect(outcome.kind).toBe("final");
    if (outcome.kind !== "final") {
      throw new Error("expected final outcome");
    }
    expect(outcome.content).toBe("Done.");
    // Quota error fed back as tool result
    const quotaToolResult = messages.find(
      (m) =>
        m.role === "tool" &&
        (m as { tool_call_id?: string }).tool_call_id === "call_q4"
    ) as { content?: string } | undefined;
    expect(quotaToolResult).toBeDefined();
    expect(quotaToolResult?.content).toContain("quota");
  });

  it("returns a tool error for malformed ask_user_question args", async () => {
    const badArgs = JSON.stringify({ question: "" });

    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_bad",
                  type: "function",
                  function: {
                    name: "ask_user_question",
                    arguments: badArgs,
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "Recovered." },
          },
        ],
      });

    const messages = buildInitialMessages("test");
    const outcome = await service.runToolLoop(messages, vi.fn());

    expect(outcome.kind).toBe("final");
    const errResult = messages.find(
      (m) =>
        m.role === "tool" &&
        (m as { tool_call_id?: string }).tool_call_id === "call_bad"
    ) as { content?: string } | undefined;
    expect(errResult?.content).toContain("Invalid ask_user_question");
  });

  describe("replyWithTools (back-compat)", () => {
    it("throws if the model tries to ask a question", async () => {
      createMock.mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_q",
                  type: "function",
                  function: {
                    name: "ask_user_question",
                    arguments: JSON.stringify({
                      question: "?",
                      options: [
                        { label: "A", value: "a" },
                        { label: "B", value: "b" },
                      ],
                    }),
                  },
                },
              ],
            },
          },
        ],
      });

      await expect(service.replyWithTools("test", vi.fn())).rejects.toThrow(
        /not supported in replyWithTools/
      );
    });
  });
});
