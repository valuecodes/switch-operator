import { describe, expect, it } from "vitest";

import { collapseWhitespace, convertContent } from "./scrape";

const expectText = (result: ReturnType<typeof convertContent>): string => {
  if (!("text" in result)) {
    throw new Error(`Expected text result, got error: ${result.error}`);
  }
  return result.text;
};

describe("convertContent", () => {
  it("converts HTML to markdown", () => {
    const result = convertContent(
      "<h1>Title</h1><p>Paragraph</p>",
      "text/html"
    );
    const text = expectText(result);
    expect(text).toContain("Title");
    expect(text).toContain("Paragraph");
  });

  it("handles application/xhtml+xml as HTML", () => {
    const result = convertContent("<p>Content</p>", "application/xhtml+xml");
    const text = expectText(result);
    expect(text).toContain("Content");
  });

  it("pretty-prints JSON", () => {
    const result = convertContent('{"a":1}', "application/json");
    const text = expectText(result);
    expect(text).toContain("```json");
    expect(text).toContain('"a": 1');
  });

  it("handles +json content types", () => {
    const result = convertContent(
      '{"data":"test"}',
      "application/vnd.api+json"
    );
    const text = expectText(result);
    expect(text).toContain("```json");
  });

  it("wraps invalid JSON in plain code block", () => {
    const result = convertContent("not json", "application/json");
    const text = expectText(result);
    expect(text).toContain("```\nnot json\n```");
  });

  it("passes plain text through", () => {
    const result = convertContent("hello world", "text/plain");
    const text = expectText(result);
    expect(text).toBe("hello world");
  });

  it("returns error for unsupported types", () => {
    const result = convertContent("data", "application/octet-stream");
    expect("error" in result).toBe(true);
  });
});

describe("collapseWhitespace", () => {
  it("collapses 3+ newlines to double", () => {
    expect(collapseWhitespace("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("collapses multiple spaces to single", () => {
    expect(collapseWhitespace("a     b")).toBe("a b");
  });

  it("trims leading and trailing whitespace", () => {
    expect(collapseWhitespace("  hello  ")).toBe("hello");
  });
});
