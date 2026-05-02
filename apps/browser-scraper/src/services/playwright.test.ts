import { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/playwright", () => ({
  launch: vi.fn(),
}));

const { launch } = await import("@cloudflare/playwright");
const { PlaywrightService } = await import("./playwright");

type GotoFn = () => Promise<{
  status: () => number;
  headers: () => Record<string, string>;
} | null>;

const makeMockBrowser = (
  overrides: {
    status?: number;
    contentType?: string;
    finalUrl?: string;
    html?: string;
    goto?: GotoFn;
  } = {}
): { browser: unknown; closeMock: ReturnType<typeof vi.fn> } => {
  const closeMock = vi.fn().mockResolvedValue(undefined);
  const goto: GotoFn =
    overrides.goto ??
    (() =>
      Promise.resolve({
        status: () => overrides.status ?? 200,
        headers: () => ({
          "content-type": overrides.contentType ?? "text/html",
        }),
      }));
  const page = {
    route: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn(goto),
    url: vi.fn().mockReturnValue(overrides.finalUrl ?? "https://example.com/"),
    content: vi.fn().mockResolvedValue(overrides.html ?? "<html></html>"),
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    close: closeMock,
  };
  return { browser, closeMock };
};

describe("PlaywrightService.render", () => {
  const logger = new Logger({ context: "test" });

  beforeEach(() => {
    vi.mocked(launch).mockReset();
  });

  it("returns rendered html on a successful navigation", async () => {
    const { browser, closeMock } = makeMockBrowser({
      html: "<html><body>hello</body></html>",
    });
    vi.mocked(launch).mockResolvedValueOnce(browser as never);

    const result = await new PlaywrightService({} as never, logger).render(
      "https://example.com/"
    );

    expect(result).toEqual({
      ok: true,
      html: "<html><body>hello</body></html>",
      finalUrl: "https://example.com/",
      status: 200,
      contentType: "text/html",
      truncated: false,
    });
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it("rejects when the post-redirect URL is unsafe", async () => {
    const { browser, closeMock } = makeMockBrowser({
      finalUrl: "https://127.0.0.1/secrets",
    });
    vi.mocked(launch).mockResolvedValueOnce(browser as never);

    const result = await new PlaywrightService({} as never, logger).render(
      "https://example.com/"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Unsafe final URL/);
    }
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it("returns an error when goto throws", async () => {
    const { browser, closeMock } = makeMockBrowser({
      goto: () => Promise.reject(new Error("Navigation timeout")),
    });
    vi.mocked(launch).mockResolvedValueOnce(browser as never);

    const result = await new PlaywrightService({} as never, logger).render(
      "https://example.com/"
    );

    expect(result).toEqual({ ok: false, error: "Navigation timeout" });
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it("returns an error for non-2xx page status", async () => {
    const { browser } = makeMockBrowser({ status: 404 });
    vi.mocked(launch).mockResolvedValueOnce(browser as never);

    const result = await new PlaywrightService({} as never, logger).render(
      "https://example.com/missing"
    );

    expect(result).toEqual({ ok: false, error: "HTTP 404", status: 404 });
  });
});
