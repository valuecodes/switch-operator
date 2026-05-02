import { launch } from "@cloudflare/playwright";
import type { BrowserWorker } from "@cloudflare/playwright";
import type { Logger } from "@repo/logger";
import { validateSourceUrl } from "@repo/url-validator";

const NAV_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 2 * 1024 * 1024;

type RenderSuccess = {
  ok: true;
  html: string;
  finalUrl: string;
  status: number;
  contentType: string;
  truncated: boolean;
};
type RenderError = { ok: false; error: string; status?: number };
type RenderResult = RenderSuccess | RenderError;

class PlaywrightService {
  constructor(
    private readonly browser: BrowserWorker,
    private readonly logger: Logger
  ) {}

  async render(url: string): Promise<RenderResult> {
    const start = Date.now();
    const browser = await launch(this.browser);
    try {
      const page = await browser.newPage();

      await page.route("**/*", (route) => {
        const reqUrl = route.request().url();
        const check = validateSourceUrl(reqUrl);
        if (!check.valid) {
          this.logger.warn("blocked unsafe subresource", {
            url: reqUrl,
            reason: check.reason,
          });
          return route.abort();
        }
        return route.continue();
      });

      let response;
      try {
        response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Navigation failed",
        };
      }

      if (!response) {
        return { ok: false, error: "No navigation response" };
      }

      const finalUrl = page.url();
      const finalCheck = validateSourceUrl(finalUrl);
      if (!finalCheck.valid) {
        return {
          ok: false,
          error: `Unsafe final URL after redirect: ${finalCheck.reason}`,
        };
      }

      const status = response.status();
      if (status < 200 || status >= 300) {
        return { ok: false, error: `HTTP ${String(status)}`, status };
      }

      const headers = response.headers();
      const contentType = headers["content-type"] ?? "";

      const html = await page.content();
      const truncated = html.length > MAX_HTML_CHARS;
      const finalHtml = truncated ? html.slice(0, MAX_HTML_CHARS) : html;

      return {
        ok: true,
        html: finalHtml,
        finalUrl,
        status,
        contentType,
        truncated,
      };
    } finally {
      await browser.close();
      this.logger.info("browser render finished", {
        url,
        browserDurationMs: Date.now() - start,
      });
    }
  }
}

export { MAX_HTML_CHARS, NAV_TIMEOUT_MS, PlaywrightService };
export type { RenderError, RenderResult, RenderSuccess };
