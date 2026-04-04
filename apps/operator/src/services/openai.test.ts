import type { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAiService } from "./openai";

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
        max_tokens: 2048,
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
});
