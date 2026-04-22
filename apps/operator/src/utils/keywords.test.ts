import { describe, expect, it } from "vitest";

import {
  extractWindows,
  findKeywordPositions,
  parseKeywords,
} from "./keywords";

describe("parseKeywords", () => {
  it("returns [] for null", () => {
    expect(parseKeywords(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(parseKeywords(undefined)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseKeywords("")).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseKeywords("{not json")).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    expect(parseKeywords('{"a": 1}')).toEqual([]);
  });

  it("filters out non-string elements", () => {
    expect(parseKeywords('[1, "Beck", true, "Test"]')).toEqual([
      "Beck",
      "Test",
    ]);
  });

  it("parses valid keyword array", () => {
    expect(parseKeywords('["Beck","Criminal Minds"]')).toEqual([
      "Beck",
      "Criminal Minds",
    ]);
  });

  it("trims whitespace from keywords", () => {
    expect(parseKeywords('[" Beck ", "  CSI  "]')).toEqual(["Beck", "CSI"]);
  });

  it("drops whitespace-only keywords", () => {
    expect(parseKeywords('["Beck", "  ", " "]')).toEqual(["Beck"]);
  });
});

describe("findKeywordPositions", () => {
  it("returns [] when no keywords match", () => {
    expect(findKeywordPositions("hello world", ["Beck"])).toEqual([]);
  });

  it("finds single occurrence", () => {
    expect(findKeywordPositions("Beck is on TV", ["Beck"])).toEqual([0]);
  });

  it("finds multiple occurrences of same keyword", () => {
    expect(findKeywordPositions("Beck at 9, Beck at 11", ["Beck"])).toEqual([
      0, 11,
    ]);
  });

  it("is case-insensitive", () => {
    expect(findKeywordPositions("BECK is on, beck too", ["Beck"])).toEqual([
      0, 12,
    ]);
  });

  it("finds positions for multiple keywords", () => {
    const positions = findKeywordPositions("Beck and CSI tonight", [
      "Beck",
      "CSI",
    ]);
    expect(positions.sort((a, b) => a - b)).toEqual([0, 9]);
  });
});

describe("extractWindows", () => {
  it("returns empty string for no positions", () => {
    expect(extractWindows("some text", [], 10)).toBe("");
  });

  it("extracts window around single match", () => {
    const text = "a".repeat(100) + "MATCH" + "b".repeat(100);
    const result = extractWindows(text, [100], 10);
    expect(result).toBe("a".repeat(10) + "MATCH" + "b".repeat(5));
    expect(result.length).toBe(20);
  });

  it("clamps to text start", () => {
    const text = "MATCH" + "x".repeat(100);
    const result = extractWindows(text, [0], 10);
    expect(result.startsWith("MATCH")).toBe(true);
    expect(result.length).toBe(10);
  });

  it("clamps to text end", () => {
    const text = "x".repeat(100) + "MATCH";
    const result = extractWindows(text, [100], 10);
    expect(result.endsWith("MATCH")).toBe(true);
    expect(result.length).toBe(15);
  });

  it("merges overlapping windows", () => {
    const text = "x".repeat(50);
    // Two positions 5 apart with window of 10 — ranges overlap
    const result = extractWindows(text, [20, 25], 10);
    // Should be one merged window from [10, 35]
    expect(result).toBe("x".repeat(25));
    expect(result.includes("---")).toBe(false);
  });

  it("separates non-overlapping windows", () => {
    const text = "x".repeat(200);
    // Two positions far apart
    const result = extractWindows(text, [10, 190], 5);
    expect(result.includes("\n\n---\n\n")).toBe(true);
  });
});
