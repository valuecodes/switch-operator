import { z } from "zod";

/**
 * A single normalized daily OHLCV bar. Values are parsed to numbers from the
 * strings Alpha Vantage returns.
 */
type DailyBar = {
  /** Trading day, `YYYY-MM-DD`. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Normalized daily timeseries. `bars` are ordered newest-first. */
type DailyTimeSeries = {
  symbol: string;
  /** Timestamp of the most recent data point, as reported by the API. */
  lastRefreshed: string;
  /** e.g. `US/Eastern`. */
  timeZone: string;
  bars: DailyBar[];
};

/**
 * Alpha Vantage signals API-level problems (invalid key, unknown symbol, rate
 * limit) with an HTTP 200 body carrying one of these keys. `@repo/http-client`
 * does not throw for 200s, so callers must inspect this shape.
 */
const alphaVantageErrorSchema = z
  .object({
    "Error Message": z.string(),
    Note: z.string(),
    Information: z.string(),
  })
  .partial()
  .loose();

const rawDailyBarSchema = z.object({
  "1. open": z.string(),
  "2. high": z.string(),
  "3. low": z.string(),
  "4. close": z.string(),
  "5. volume": z.string(),
});

/**
 * Raw `TIME_SERIES_DAILY` success payload, transformed into the clean
 * {@link DailyTimeSeries} shape.
 */
const dailyResponseSchema = z
  .object({
    "Meta Data": z
      .object({
        "2. Symbol": z.string(),
        "3. Last Refreshed": z.string(),
        "5. Time Zone": z.string(),
      })
      .loose(),
    "Time Series (Daily)": z.record(z.string(), rawDailyBarSchema),
  })
  .transform((raw): DailyTimeSeries => {
    const meta = raw["Meta Data"];
    const bars = Object.entries(raw["Time Series (Daily)"])
      .map(
        ([date, bar]): DailyBar => ({
          date,
          open: Number(bar["1. open"]),
          high: Number(bar["2. high"]),
          low: Number(bar["3. low"]),
          close: Number(bar["4. close"]),
          volume: Number(bar["5. volume"]),
        })
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      symbol: meta["2. Symbol"],
      lastRefreshed: meta["3. Last Refreshed"],
      timeZone: meta["5. Time Zone"],
      bars,
    };
  });

export { alphaVantageErrorSchema, dailyResponseSchema };
export type { DailyBar, DailyTimeSeries };
