import { describe, expect, it } from "vitest";

import {
  splitMessage,
  TELEGRAM_HTML_SAFE_LENGTH,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "./message";

describe("splitMessage", () => {
  it("returns a single chunk when text fits in default max", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("returns a single chunk at exactly the default max", () => {
    const text = "x".repeat(TELEGRAM_MAX_MESSAGE_LENGTH);
    expect(splitMessage(text)).toEqual([text]);
  });

  it("splits longer text into multiple chunks", () => {
    const text = "x".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 100);
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("prefers newline boundaries when splitting", () => {
    const para = "a".repeat(2000);
    const text = `${para}\n${para}\n${para}`;
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.endsWith("a")).toBe(true);
      expect(chunk.includes("\n\n")).toBe(false);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("respects a custom maxLength", () => {
    const text = "x".repeat(100);
    const chunks = splitMessage(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("uses TELEGRAM_HTML_SAFE_LENGTH as a smaller bound for HTML callers", () => {
    expect(TELEGRAM_HTML_SAFE_LENGTH).toBeLessThan(TELEGRAM_MAX_MESSAGE_LENGTH);
    const text = "y".repeat(TELEGRAM_HTML_SAFE_LENGTH + 100);
    const chunks = splitMessage(text, TELEGRAM_HTML_SAFE_LENGTH);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_HTML_SAFE_LENGTH);
    }
  });
});
