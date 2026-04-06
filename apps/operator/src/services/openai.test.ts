import type { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAiService } from "./openai";
import type { ToolExecutor } from "./openai";

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
