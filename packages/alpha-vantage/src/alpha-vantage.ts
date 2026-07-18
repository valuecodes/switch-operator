import { HttpClient } from "@repo/http-client";
import type { Logger } from "@repo/logger";
import { z } from "zod";

import type { DailyTimeSeries } from "./types";
import {
  alphaVantageErrorSchema,
  dailyResponseSchema,
  weeklyResponseSchema,
} from "./types";

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
 *
 * Identical requests are de-duplicated for the instance's lifetime: concurrent
 * and repeat calls with the same parameters share a single in-flight (or
 * already-resolved) HTTP request. This keeps the free tier's 1-request-per-second
 * burst limit safe when several callers (e.g. multiple alerts) fetch the same
 * series in the same run. A failed request is evicted so a later call can retry.
 */
class AlphaVantageClient {
  private readonly client: HttpClient;
  private readonly apiKey: string;
  /** In-flight/resolved requests keyed by endpoint + params (see `memoize`). */
  private readonly cache = new Map<string, Promise<DailyTimeSeries>>();

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
  getDailyTimeSeries(
    symbol: string,
    options: DailyTimeSeriesOptions = {}
  ): Promise<DailyTimeSeries> {
    const outputSize = options.outputSize ?? "compact";
    return this.memoize(`daily|${symbol}|${outputSize}`, async () => {
      const raw = await this.client.get("/query", {
        schema: rawResponseSchema,
        // Passed as `query` (not baked into the path) so the API key stays out of logs.
        query: {
          function: "TIME_SERIES_DAILY",
          symbol,
          outputsize: outputSize,
          apikey: this.apiKey,
        },
      });

      return dailyResponseSchema.parse(this.assertNoApiError(raw));
    });
  }

  /**
   * Fetch the weekly OHLCV timeseries for `symbol`. Unlike the daily endpoint,
   * `TIME_SERIES_WEEKLY` returns the full multi-year history for free (no
   * `outputsize` parameter, no premium gating) — use it to establish an
   * all-time high without a paid plan.
   *
   * @throws {AlphaVantageError} on an API-level error (bad key/symbol, rate limit).
   */
  getWeeklyTimeSeries(symbol: string): Promise<DailyTimeSeries> {
    return this.memoize(`weekly|${symbol}`, async () => {
      const raw = await this.client.get("/query", {
        schema: rawResponseSchema,
        // Passed as `query` (not baked into the path) so the API key stays out of logs.
        query: {
          function: "TIME_SERIES_WEEKLY",
          symbol,
          apikey: this.apiKey,
        },
      });

      return weeklyResponseSchema.parse(this.assertNoApiError(raw));
    });
  }

  /**
   * Return the cached promise for `key`, or start `fetcher`, cache its promise
   * (so concurrent callers share one HTTP request), and evict on rejection so a
   * failed request isn't cached — a later identical call retries.
   */
  private memoize(
    key: string,
    fetcher: () => Promise<DailyTimeSeries>
  ): Promise<DailyTimeSeries> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const promise = fetcher().catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, promise);
    return promise;
  }

  /**
   * Alpha Vantage signals errors (bad key/symbol, exhausted rate limit) in an
   * HTTP 200 body. Throw on those; otherwise return the raw body for parsing.
   *
   * @throws {AlphaVantageError} when the body carries an API-level error.
   */
  private assertNoApiError(raw: unknown): unknown {
    const apiError = alphaVantageErrorSchema.parse(raw);
    const errorMessage =
      apiError["Error Message"] ?? apiError.Note ?? apiError.Information;
    if (errorMessage !== undefined) {
      throw new AlphaVantageError(errorMessage);
    }
    return raw;
  }
}

export { AlphaVantageClient, AlphaVantageError };
