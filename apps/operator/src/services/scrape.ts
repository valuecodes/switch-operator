import { validateSourceUrl } from "@repo/url-validator";
import { NodeHtmlMarkdown } from "node-html-markdown";

type ScrapeOk = { ok: true; text: string; truncated: boolean };
type ScrapeError = { ok: false; error: string; statusCode?: number };
type ScrapeResult = ScrapeOk | ScrapeError;

type ScrapeOptions = {
  maxTextLength?: number;
  browserScraper?: Fetcher;
  useBrowser?: boolean;
};

type FetchedContent =
  | { ok: true; raw: string; contentType: string; truncated?: boolean }
  | { ok: false; error: string; statusCode?: number };

type BrowserScraperResponse =
  | {
      ok: true;
      html: string;
      finalUrl: string;
      status: number;
      contentType: string;
      truncated: boolean;
    }
  | { ok: false; error: string; status?: number };

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const DEFAULT_MAX_TEXT_LENGTH = 80_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const USER_AGENT = "SwitchOperator/1.0";

const ERROR_MAP: Partial<Record<number, string>> = {
  403: "Blocked by site",
  404: "Page not found",
  429: "Rate limited by site",
};

const isHtml = (contentType: string): boolean =>
  contentType.includes("text/html") ||
  contentType.includes("application/xhtml+xml");

const isJson = (contentType: string): boolean =>
  contentType.includes("application/json") || contentType.includes("+json");

const isPlainText = (contentType: string): boolean =>
  contentType.includes("text/plain");

const concatChunks = (chunks: Uint8Array[], totalBytes: number): Uint8Array => {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const readBodyWithLimit = async (
  body: ReadableStream<Uint8Array>
): Promise<{ bytes: Uint8Array } | { error: string }> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: "Response exceeds 2MB size limit" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { bytes: concatChunks(chunks, totalBytes) };
};

const collapseWhitespace = (text: string): string =>
  text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const convertContent = (
  raw: string,
  rawContentType: string
): { text: string } | { error: string } => {
  const contentType = rawContentType.toLowerCase();
  if (isHtml(contentType)) {
    const markdown = NodeHtmlMarkdown.translate(raw);
    return { text: collapseWhitespace(markdown) };
  }

  if (isJson(contentType)) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const pretty = JSON.stringify(parsed, null, 2);
      return { text: `\`\`\`json\n${pretty}\n\`\`\`` };
    } catch {
      return { text: `\`\`\`\n${raw}\n\`\`\`` };
    }
  }

  if (isPlainText(contentType)) {
    return { text: collapseWhitespace(raw) };
  }

  return { error: `Unsupported content type: ${contentType}` };
};

const isRedirect = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

const fetchWithSafeRedirects = async (
  initialUrl: string
): Promise<Response> => {
  let currentUrl = initialUrl;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "manual",
    });

    if (!isRedirect(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    const resolved = new URL(location, currentUrl).toString();
    const check = validateSourceUrl(resolved);
    if (!check.valid) {
      throw new Error(`Redirect to unsafe URL: ${check.reason}`);
    }

    currentUrl = resolved;
  }

  throw new Error("Too many redirects");
};

const fetchViaNative = async (url: string): Promise<FetchedContent> => {
  let response: Response;
  try {
    response = await fetchWithSafeRedirects(url);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { ok: false, error: "Request timed out" };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Fetch failed",
    };
  }

  if (!response.ok) {
    const mapped = ERROR_MAP[response.status];
    return {
      ok: false,
      error: mapped ?? `HTTP ${String(response.status)}`,
      statusCode: response.status,
    };
  }

  if (!response.body) {
    return { ok: false, error: "Empty response body" };
  }

  const bodyResult = await readBodyWithLimit(
    response.body as ReadableStream<Uint8Array>
  );
  if ("error" in bodyResult) {
    return { ok: false, error: bodyResult.error };
  }

  const raw = new TextDecoder().decode(bodyResult.bytes);
  const contentType = response.headers.get("content-type") ?? "";

  return { ok: true, raw, contentType };
};

const fetchViaBrowserScraper = async (
  browserScraper: Fetcher,
  url: string
): Promise<FetchedContent> => {
  let response: Response;
  try {
    response = await browserScraper.fetch("https://browser-scraper/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Browser scraper unreachable",
    };
  }

  let body: BrowserScraperResponse;
  try {
    body = await response.json<BrowserScraperResponse>();
  } catch {
    return {
      ok: false,
      error: `Browser scraper returned invalid JSON (HTTP ${String(response.status)})`,
    };
  }

  if (!body.ok) {
    const status = body.status;
    const mapped = status !== undefined ? ERROR_MAP[status] : undefined;
    return status !== undefined
      ? { ok: false, error: mapped ?? body.error, statusCode: status }
      : { ok: false, error: body.error };
  }

  return {
    ok: true,
    raw: body.html,
    contentType: body.contentType,
    truncated: body.truncated,
  };
};

const scrapeUrl = async (
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> => {
  const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;

  const fetched =
    options.useBrowser === true && options.browserScraper
      ? await fetchViaBrowserScraper(options.browserScraper, url)
      : await fetchViaNative(url);

  if (!fetched.ok) {
    return fetched;
  }

  const converted = convertContent(fetched.raw, fetched.contentType);
  if ("error" in converted) {
    return { ok: false, error: converted.error };
  }

  const textTruncated = converted.text.length > maxTextLength;
  const text = textTruncated
    ? converted.text.slice(0, maxTextLength)
    : converted.text;

  return {
    ok: true,
    text,
    truncated: textTruncated || fetched.truncated === true,
  };
};

export {
  collapseWhitespace,
  convertContent,
  DEFAULT_MAX_TEXT_LENGTH,
  FETCH_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  scrapeUrl,
  USER_AGENT,
};
export type { ScrapeOptions, ScrapeResult };
