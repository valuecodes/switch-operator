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

describe("OpenAiService", () => {
  let service: OpenAiService;

  beforeEach(() => {
    service = new OpenAiService("test-api-key", createMockLogger());
    createMock.mockReset();
    constructorMock.mockReset();
  });

  it("configures timeout and disables retries", () => {
    new OpenAiService("key", createMockLogger());

    expect(constructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 25_000,
        maxRetries: 0,
      })
    );
  });

  describe("reply", () => {
    it("returns the assistant message content", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: "Hello! How can I help?" } }],
      });

      const result = await service.reply("hi");

      expect(result).toBe("Hello! How can I help?");
    });

    it("sends the correct messages to the API", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: "response" } }],
      });

      await service.reply("test message");

      expect(createMock).toHaveBeenCalledWith({
        model: "gpt-5.4-mini",
        max_completion_tokens: 2048,
        messages: [
          {
            role: "system",
            content: expect.stringContaining("Switch Operator") as string,
          },
          { role: "user", content: "test message" },
        ],
      });
    });

    it("throws when response has no content", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      await expect(service.reply("hi")).rejects.toThrow(
        "OpenAI returned empty response"
      );
    });

    it("throws when response has no choices", async () => {
      createMock.mockResolvedValueOnce({ choices: [] });

      await expect(service.reply("hi")).rejects.toThrow(
        "OpenAI returned empty response"
      );
    });
  });

  describe("replyWithTools", () => {
    it("returns text when no tool calls", async () => {
      createMock.mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Here is your answer", tool_calls: undefined },
          },
        ],
      });

      const executor = vi.fn();
      const result = await service.replyWithTools("hello", executor);

      expect(result).toBe("Here is your answer");
      expect(executor).not.toHaveBeenCalled();
    });

    it("executes tool calls and returns final text", async () => {
      createMock
        .mockResolvedValueOnce({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "list_schedules",
                      arguments: "{}",
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
              message: {
                content: "You have 2 schedules.",
                tool_calls: undefined,
              },
            },
          ],
        });

      const executor: ToolExecutor = vi.fn().mockResolvedValueOnce({
        result: JSON.stringify([{ id: "1" }, { id: "2" }]),
      });

      const result = await service.replyWithTools(
        "list my schedules",
        executor
      );

      expect(result).toBe("You have 2 schedules.");
      expect(executor).toHaveBeenCalledWith("list_schedules", {});
    });

    it("handles multiple tool calls in one response", async () => {
      createMock
        .mockResolvedValueOnce({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "list_schedules",
                      arguments: "{}",
                    },
                  },
                  {
                    id: "call_2",
                    type: "function",
                    function: {
                      name: "list_schedules",
                      arguments: "{}",
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
              message: { content: "Done.", tool_calls: undefined },
            },
          ],
        });

      const executor: ToolExecutor = vi
        .fn()
        .mockResolvedValue({ result: "[]" });

      await service.replyWithTools("test", executor);

      expect(executor).toHaveBeenCalledTimes(2);
    });

    it("throws after max iterations", async () => {
      // Always return tool calls to exhaust iterations
      createMock.mockResolvedValue({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_loop",
                  type: "function",
                  function: {
                    name: "list_schedules",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
      });

      const executor: ToolExecutor = vi
        .fn()
        .mockResolvedValue({ result: "[]" });

      await expect(
        service.replyWithTools("infinite loop", executor)
      ).rejects.toThrow("Tool calling exceeded maximum iterations");
    });

    it("throws when no choices returned", async () => {
      createMock.mockResolvedValueOnce({ choices: [] });

      await expect(service.replyWithTools("test", vi.fn())).rejects.toThrow();
    });

    it("skips non-function tool calls", async () => {
      createMock
        .mockResolvedValueOnce({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_custom",
                    type: "custom",
                    custom: { name: "something", input: "{}" },
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
              message: { content: "Skipped.", tool_calls: undefined },
            },
          ],
        });

      const executor = vi.fn();
      const result = await service.replyWithTools("test", executor);

      expect(result).toBe("Skipped.");
      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe("runToolLoop", () => {
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
        return;
      }
      expect(outcome.toolCallId).toBe("call_q1");
      expect(outcome.question).toBe("Use browser rendering?");
      expect(outcome.options).toHaveLength(2);
      expect(outcome.options[0].value).toBe(true);
      expect(outcome.options[1].value).toBe(false);
      // The paused outcome contains the assistant turn but no tool result yet
      // for the question's tool_call_id.
      expect(executor).not.toHaveBeenCalled();
      const lastMsg = outcome.messages[outcome.messages.length - 1];
      expect(lastMsg.role).toBe("assistant");
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
      const priorAnswer = (id: string): unknown => ({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify({ value: true, label: "Yes" }),
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
        return;
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

  describe("analyzeMonitor", () => {
    it("returns parsed monitor analysis", async () => {
      const analysis = {
        notify: true,
        message: "Seinfeld is on TV at 20:00 on MTV3",
        newState: "Current listings include Seinfeld at 20:00",
      };
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(analysis) } }],
      });

      const result = await service.analyzeMonitor({
        task: "Check if Seinfeld is on today",
        scrapedContent: "# TV Listings\n- 20:00 Seinfeld (MTV3)",
        previousState: null,
      });

      expect(result).toEqual(analysis);
    });

    it("sends structured request with json_object format", async () => {
      createMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                notify: false,
                message: "",
                newState: "no changes",
              }),
            },
          },
        ],
      });

      await service.analyzeMonitor({
        task: "Check for changes",
        scrapedContent: "content",
        previousState: "old state",
      });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: "json_object" },
          max_completion_tokens: 4096,
        })
      );
    });

    it("includes previous state in user message", async () => {
      createMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                notify: true,
                message: "Changed",
                newState: "new",
              }),
            },
          },
        ],
      });

      await service.analyzeMonitor({
        task: "Check diff",
        scrapedContent: "new content",
        previousState: "old content summary",
      });

      const callArgs = createMock.mock.calls[0] as [
        { messages: { content: string }[] },
      ];
      const userMsg = callArgs[0].messages[1].content;
      expect(userMsg).toContain("old content summary");
    });

    it("uses placeholder when no previous state", async () => {
      createMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                notify: true,
                message: "First check",
                newState: "initial",
              }),
            },
          },
        ],
      });

      await service.analyzeMonitor({
        task: "Monitor page",
        scrapedContent: "content",
        previousState: null,
      });

      const callArgs = createMock.mock.calls[0] as [
        { messages: { content: string }[] },
      ];
      const userMsg = callArgs[0].messages[1].content;
      expect(userMsg).toContain("First check");
    });

    it("throws on empty response", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      await expect(
        service.analyzeMonitor({
          task: "test",
          scrapedContent: "content",
          previousState: null,
        })
      ).rejects.toThrow("OpenAI returned empty response for monitor analysis");
    });

    it("throws on invalid JSON structure", async () => {
      createMock.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ wrong: "structure" }),
            },
          },
        ],
      });

      await expect(
        service.analyzeMonitor({
          task: "test",
          scrapedContent: "content",
          previousState: null,
        })
      ).rejects.toThrow();
    });
  });
});
