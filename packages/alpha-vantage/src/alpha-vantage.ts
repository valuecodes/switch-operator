import { HttpClient } from "@repo/http-client";
import type { Logger } from "@repo/logger";
import { z } from "zod";

import type { DailyTimeSeries } from "./types";
import { alphaVantageErrorSchema, dailyResponseSchema } from "./types";

const BASE_URL = "https://www.alphavantage.co";

/** Any object; the shape is validated per-endpoint after error detection. */
const rawResponseSchema = z.record(z.string(), z.unknown());

type DailyTimeSeriesOptions = {
  /**
   * `compact` returns the latest ~100 data points (default); `full` returns
   * the full-length history (20+ years).
   */
  outputSize?: "compact" | "full";
};

/**
 * Thrown when Alpha Vantage returns an application-level error in an HTTP 200
 * body — an invalid API key, unknown symbol, or an exhausted rate limit.
 */
class AlphaVantageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlphaVantageError";
  }
}

/**
 * Thin wrapper over the Alpha Vantage REST API. Construct one per API key and
 * reuse it. Note: the underlying `HttpClient` applies no timeout or retry
 * (matching how `@repo/telegram` uses it) — add `AbortSignal.timeout` here if
 * that becomes necessary.
 */
class AlphaVantageClient {
  private readonly client: HttpClient;
  private readonly apiKey: string;

  constructor(apiKey: string, logger: Logger) {
    this.apiKey = apiKey;
    this.client = new HttpClient({ logger, baseUrl: BASE_URL });
  }

  /**
   * Fetch the daily OHLCV timeseries for `symbol`. ETFs such as `SPY`
   * (S&P 500) and `QQQ` (Nasdaq-100) are ordinary symbols here.
   *
   * @throws {AlphaVantageError} on an API-level error (bad key/symbol, rate limit).
   */
  async getDailyTimeSeries(
    symbol: string,
    options: DailyTimeSeriesOptions = {}
  ): Promise<DailyTimeSeries> {
    const raw = await this.client.get("/query", {
      schema: rawResponseSchema,
      // Passed as `query` (not baked into the path) so the API key stays out of logs.
      query: {
        function: "TIME_SERIES_DAILY",
        symbol,
        outputsize: options.outputSize ?? "compact",
        apikey: this.apiKey,
      },
    });

    const apiError = alphaVantageErrorSchema.parse(raw);
    const errorMessage =
      apiError["Error Message"] ?? apiError.Note ?? apiError.Information;
    if (errorMessage !== undefined) {
      throw new AlphaVantageError(errorMessage);
    }

    return dailyResponseSchema.parse(raw);
  }
}

export { AlphaVantageClient, AlphaVantageError };
