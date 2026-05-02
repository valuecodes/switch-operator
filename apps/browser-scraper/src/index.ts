import type { BrowserWorker } from "@cloudflare/playwright";
import { Logger } from "@repo/logger";
import { validateSourceUrl } from "@repo/url-validator";
import { z } from "zod";

import { PlaywrightService } from "./services/playwright";

type Env = { BROWSER: BrowserWorker };

const requestSchema = z.object({ url: z.string() });

const handle = async (request: Request, env: Env): Promise<Response> => {
  const logger = new Logger({ context: "browser-scraper" });

  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed" },
      { status: 405 }
    );
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    const body: unknown = await request.json();
    parsed = requestSchema.parse(body);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid body",
      },
      { status: 400 }
    );
  }

  const check = validateSourceUrl(parsed.url);
  if (!check.valid) {
    return Response.json(
      { ok: false, error: `Invalid URL: ${check.reason}` },
      { status: 400 }
    );
  }

  try {
    const result = await new PlaywrightService(env.BROWSER, logger).render(
      parsed.url
    );
    return Response.json(result);
  } catch (error) {
    logger.error("unexpected render failure", {
      url: parsed.url,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { ok: false, error: "Internal render failure" },
      { status: 500 }
    );
  }
};

// eslint-disable-next-line import/no-default-export
export default {
  fetch: handle,
};
