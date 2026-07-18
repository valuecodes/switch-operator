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

const rawBarSchema = z.object({
  "1. open": z.string(),
  "2. high": z.string(),
  "3. low": z.string(),
  "4. close": z.string(),
  "5. volume": z.string(),
});

type RawBar = z.infer<typeof rawBarSchema>;

const toBar = (date: string, bar: RawBar): DailyBar => ({
  date,
  open: Number(bar["1. open"]),
  high: Number(bar["2. high"]),
  low: Number(bar["3. low"]),
  close: Number(bar["4. close"]),
  volume: Number(bar["5. volume"]),
});

/**
 * Builds a schema for one of the OHLCV timeseries endpoints. They share the
 * bar shape but differ in the series key (`Time Series (Daily)` vs
 * `Weekly Time Series`) and where the time zone lives in `Meta Data` (daily
 * puts it at `5. Time Zone`, weekly at `4. Time Zone`). Bars come out
 * newest-first.
 */
const timeSeriesSchema = (seriesKey: string, timeZoneKey: string) =>
  z
    .object({
      "Meta Data": z
        .object({
          "2. Symbol": z.string(),
          "3. Last Refreshed": z.string(),
          [timeZoneKey]: z.string(),
        })
        .loose(),
      [seriesKey]: z.record(z.string(), rawBarSchema),
    })
    .transform((raw): DailyTimeSeries => {
      const meta = raw["Meta Data"] as Record<string, string>;
      const series = raw[seriesKey] as Record<string, RawBar>;
      const bars = Object.entries(series)
        .map(([date, bar]) => toBar(date, bar))
        .sort((a, b) => (a.date < b.date ? 1 : -1));

      return {
        symbol: meta["2. Symbol"],
        lastRefreshed: meta["3. Last Refreshed"],
        timeZone: meta[timeZoneKey],
        bars,
      };
    });

/**
 * Raw `TIME_SERIES_DAILY` success payload, transformed into the clean
 * {@link DailyTimeSeries} shape.
 */
const dailyResponseSchema = timeSeriesSchema(
  "Time Series (Daily)",
  "5. Time Zone"
);

/**
 * Raw `TIME_SERIES_WEEKLY` success payload, transformed into the same
 * {@link DailyTimeSeries} shape (a weekly bar is structurally identical).
 */
const weeklyResponseSchema = timeSeriesSchema(
  "Weekly Time Series",
  "4. Time Zone"
);

export { alphaVantageErrorSchema, dailyResponseSchema, weeklyResponseSchema };
export type { DailyBar, DailyTimeSeries };
