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

/**
 * Minimum spacing between request starts, honoring Alpha Vantage's free-tier
 * "1 request per second" burst limit with a little margin.
 */
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1100;

/** Any object; the shape is validated per-endpoint after error detection. */
const rawResponseSchema = z.record(z.string(), z.unknown());

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * De-duplication key for a request. `JSON.stringify` keeps the parts
 * unambiguous, so a symbol containing the separator can't collide with a
 * different request.
 */
const keyOf = (...parts: string[]): string => JSON.stringify(parts);

type DailyTimeSeriesOptions = {
  /**
   * `compact` returns the latest ~100 data points (default); `full` returns
   * the full-length history (20+ years).
   */
  outputSize?: "compact" | "full";
};

type AlphaVantageClientOptions = {
  /**
   * Minimum milliseconds between request starts (see
   * `DEFAULT_MIN_REQUEST_INTERVAL_MS`). Set to `0` to disable throttling, e.g.
   * in tests.
   */
  minRequestIntervalMs?: number;
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
 * The client keeps the free tier's "1 request per second" burst limit safe for
 * every caller that shares it (e.g. all alerts in a run) in two ways:
 * - Concurrent *identical* requests are de-duplicated: while one is in flight,
 *   other callers share it rather than issuing their own. The entry is dropped
 *   once the request settles, so a reused client still fetches fresh data and a
 *   failure never poisons later calls.
 * - *Distinct* requests are serialized and spaced at least
 *   `minRequestIntervalMs` apart, so a burst of different series (e.g. daily +
 *   weekly) can't fire in the same instant.
 */
class AlphaVantageClient {
  private readonly client: HttpClient;
  private readonly apiKey: string;
  private readonly minRequestIntervalMs: number;
  /** In-flight requests keyed by endpoint + params (see `memoize`). */
  private readonly inFlight = new Map<string, Promise<DailyTimeSeries>>();
  /** Tail of the serialized request queue (see `schedule`). */
  private queue: Promise<unknown> = Promise.resolve();
  /** `Date.now()` when the most recent queued request started. */
  private lastRequestStart = 0;

  constructor(
    apiKey: string,
    logger: Logger,
    options: AlphaVantageClientOptions = {}
  ) {
    this.apiKey = apiKey;
    this.client = new HttpClient({ logger, baseUrl: BASE_URL });
    this.minRequestIntervalMs =
      options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;
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
    return this.memoize(keyOf("daily", symbol, outputSize), async () => {
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
    return this.memoize(keyOf("weekly", symbol), async () => {
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
   * Share an in-flight request: return the pending promise for `key` if one
   * exists, otherwise start `fetcher` (via `schedule`) and register its promise
   * so concurrent callers reuse it. The entry is removed once the request
   * settles (success or failure), so this de-duplicates bursts without caching
   * results — later calls fetch fresh data, and a failure never poisons a
   * subsequent call.
   */
  private memoize(
    key: string,
    fetcher: () => Promise<DailyTimeSeries>
  ): Promise<DailyTimeSeries> {
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      return pending;
    }

    const promise = this.schedule(fetcher);
    this.inFlight.set(key, promise);
    const evict = () => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    };
    // Settle in both directions; the rejection handler here keeps the eviction
    // chain from surfacing as an unhandled rejection (callers await `promise`).
    promise.then(evict, evict);
    return promise;
  }

  /**
   * Run `fetcher` on the serial queue, starting it no sooner than
   * `minRequestIntervalMs` after the previous queued request began. This keeps
   * distinct requests from bursting past the free-tier per-second limit. The
   * queue chain swallows settlement so one failing request can't stall the rest.
   */
  private schedule(
    fetcher: () => Promise<DailyTimeSeries>
  ): Promise<DailyTimeSeries> {
    const run = this.queue.then(async () => {
      const wait =
        this.minRequestIntervalMs - (Date.now() - this.lastRequestStart);
      if (wait > 0) {
        await delay(wait);
      }
      this.lastRequestStart = Date.now();
      return fetcher();
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
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
