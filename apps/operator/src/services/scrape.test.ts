import { afterEach, describe, expect, it, vi } from "vitest";

import { collapseWhitespace, convertContent, scrapeUrl } from "./scrape";

const createMockResponse = (
  body: string,
  init?: { status?: number; headers?: Record<string, string> }
): Response =>
  new Response(body, {
    status: init?.status ?? 200,
    headers: init?.headers ?? { "content-type": "text/html" },
  });

describe("scrapeUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts HTML response to markdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(createMockResponse("<h1>Hello</h1><p>World</p>"))
    );

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Hello");
      expect(result.text).toContain("World");
      expect(result.truncated).toBe(false);
    }
  });

  it("handles JSON response with pretty-print", async () => {
    const json = JSON.stringify({ key: "value", nested: { a: 1 } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        createMockResponse(json, {
          headers: { "content-type": "application/json" },
        })
      )
    );

    const result = await scrapeUrl("https://api.example.com/data");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("```json");
      expect(result.text).toContain('"key": "value"');
      expect(result.text).toContain("```");
    }
  });

  it("handles plain text response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        createMockResponse("Plain text content", {
          headers: { "content-type": "text/plain" },
        })
      )
    );

    const result = await scrapeUrl("https://example.com/robots.txt");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Plain text content");
    }
  });

  it("returns error for unsupported content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        createMockResponse("binary", {
          headers: { "content-type": "application/octet-stream" },
        })
      )
    );

    const result = await scrapeUrl("https://example.com/file.bin");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported content type");
    }
  });

  it("returns error for non-ok HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(createMockResponse("Forbidden", { status: 403 }))
    );

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Blocked by site");
      expect(result.statusCode).toBe(403);
    }
  });

  it("returns error for 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(createMockResponse("Not found", { status: 404 }))
    );

    const result = await scrapeUrl("https://example.com/missing");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Page not found");
      expect(result.statusCode).toBe(404);
    }
  });

  it("returns generic error for unmapped status codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(createMockResponse("Error", { status: 502 }))
    );

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("HTTP 502");
    }
  });

  it("truncates text exceeding maxTextLength", async () => {
    const longHtml = `<p>${"a".repeat(1000)}</p>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(createMockResponse(longHtml))
    );

    const result = await scrapeUrl("https://example.com", {
      maxTextLength: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.length).toBeLessThanOrEqual(100);
      expect(result.truncated).toBe(true);
    }
  });

  it("returns error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Network error"))
    );

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Network error");
    }
  });

  it("returns error on timeout", async () => {
    const timeoutError = new DOMException("Timeout", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(timeoutError));

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Request timed out");
    }
  });

  it("follows safe redirects", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/final" },
        })
      )
      .mockResolvedValueOnce(createMockResponse("<p>Redirected</p>"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await scrapeUrl("https://example.com/start");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Redirected");
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects to localhost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/secret" },
        })
      )
    );

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Redirect to unsafe URL");
    }
  });

  it("rejects redirects to HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "http://example.com/page" },
        })
      )
    );

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Redirect to unsafe URL");
    }
  });

  it("returns error on too many redirects", async () => {
    const redirectResponse = new Response(null, {
      status: 302,
      headers: { location: "https://example.com/loop" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirectResponse));

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Too many redirects");
    }
  });

  it("returns error when response body exceeds 2MB", async () => {
    const largeBody = "x".repeat(3 * 1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(createMockResponse(largeBody))
    );

    const result = await scrapeUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Response exceeds 2MB size limit");
    }
  });
});

describe("scrapeUrl via browserScraper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeFetcher = (response: Response): Fetcher =>
    ({ fetch: vi.fn().mockResolvedValue(response) }) as unknown as Fetcher;

  it("returns markdown from a successful browser-scraper response", async () => {
    const browserScraper = makeFetcher(
      Response.json({
        ok: true,
        html: "<h1>Hello SPA</h1>",
        finalUrl: "https://example.com/",
        status: 200,
        contentType: "text/html",
        truncated: false,
      })
    );

    const result = await scrapeUrl("https://example.com", {
      browserScraper,
      useBrowser: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Hello SPA");
    }
  });

  it("propagates truncated=true from browser-scraper even when text fits within maxTextLength", async () => {
    const browserScraper = makeFetcher(
      Response.json({
        ok: true,
        html: "<p>short content</p>",
        finalUrl: "https://example.com/",
        status: 200,
        contentType: "text/html",
        truncated: true,
      })
    );

    const result = await scrapeUrl("https://example.com", {
      browserScraper,
      useBrowser: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
    }
  });

  it("propagates error when browser-scraper returns ok:false without status", async () => {
    const browserScraper = makeFetcher(
      Response.json({ ok: false, error: "Navigation timeout" })
    );

    const result = await scrapeUrl("https://example.com", {
      browserScraper,
      useBrowser: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Navigation timeout");
    }
  });

  it("maps browser-scraper status through ERROR_MAP", async () => {
    const browserScraper = makeFetcher(
      Response.json({ ok: false, error: "HTTP 403", status: 403 })
    );

    const result = await scrapeUrl("https://example.com", {
      browserScraper,
      useBrowser: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Blocked by site");
      expect(result.statusCode).toBe(403);
    }
  });

  it("returns error when browser-scraper returns invalid JSON", async () => {
    const browserScraper = makeFetcher(
      new Response("not-json", {
        status: 500,
        headers: { "content-type": "text/plain" },
      })
    );

    const result = await scrapeUrl("https://example.com", {
      browserScraper,
      useBrowser: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid JSON/);
    }
  });

  it("uses native fetch when useBrowser is false even if browserScraper is provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createMockResponse("<p>fetched</p>"));
    vi.stubGlobal("fetch", fetchMock);

    const browserScraperFetch = vi.fn();
    const browserScraper = {
      fetch: browserScraperFetch,
    } as unknown as Fetcher;

    const result = await scrapeUrl("https://example.com", {
      browserScraper,
      useBrowser: false,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(browserScraperFetch).not.toHaveBeenCalled();
  });
});

describe("convertContent", () => {
  it("converts HTML to markdown", () => {
    const result = convertContent(
      "<h1>Title</h1><p>Paragraph</p>",
      "text/html"
    );
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toContain("Title");
      expect(result.text).toContain("Paragraph");
    }
  });

  it("handles application/xhtml+xml as HTML", () => {
    const result = convertContent("<p>Content</p>", "application/xhtml+xml");
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toContain("Content");
    }
  });

  it("pretty-prints JSON", () => {
    const result = convertContent('{"a":1}', "application/json");
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toContain("```json");
      expect(result.text).toContain('"a": 1');
    }
  });

  it("handles +json content types", () => {
    const result = convertContent(
      '{"data":"test"}',
      "application/vnd.api+json"
    );
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toContain("```json");
    }
  });

  it("wraps invalid JSON in plain code block", () => {
    const result = convertContent("not json", "application/json");
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toContain("```\nnot json\n```");
    }
  });

  it("passes plain text through", () => {
    const result = convertContent("hello world", "text/plain");
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toBe("hello world");
    }
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
