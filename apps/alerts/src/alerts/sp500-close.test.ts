import type { DailyBar, DailyTimeSeries } from "@repo/alpha-vantage/types";
import type { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sp500Close } from "./sp500-close";

// The alert (via `fetchSp500`) calls both `getDailyTimeSeries` (recent closes)
// and `getWeeklyTimeSeries` (ATH baseline). `daily` drives the reported close;
// `weekly` supplies the historical high. Both are controlled per-test.
let daily: DailyTimeSeries;
let weekly: DailyTimeSeries;

vi.mock("@repo/alpha-vantage", () => ({
  AlphaVantageClient: class {
    getDailyTimeSeries = () => Promise.resolve(daily);
    getWeeklyTimeSeries = () => Promise.resolve(weekly);
  },
}));

const createMockLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as Logger;

/** Build a newest-first series from `closes` (index 0 is the latest close). */
const seriesFromCloses = (closes: number[]): DailyTimeSeries => ({
  symbol: "SPY",
  lastRefreshed: "2026-07-11",
  timeZone: "US/Eastern",
  bars: closes.map(
    (close, i): DailyBar => ({
      date: `2026-07-${String(11 - i).padStart(2, "0")}`,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1_000_000,
    })
  ),
});

/**
 * Weekly series with week-ending dates in June — strictly *before* the July
 * daily window above, so `fetchSp500` counts them as the historical baseline.
 */
const weeklyFromCloses = (closes: number[]): DailyTimeSeries => ({
  symbol: "SPY",
  lastRefreshed: "2026-06-26",
  timeZone: "US/Eastern",
  bars: closes.map(
    (close, i): DailyBar => ({
      date: `2026-06-${String(26 - i * 7).padStart(2, "0")}`,
      open: close,
      high: close,
      low: close,
      close,
      volume: 5_000_000,
    })
  ),
});

const env = {
  TELEGRAM_BOT_TOKEN: "test-token",
  ALLOWED_CHAT_ID: "12345",
  ALPHA_VANTAGE_API_KEY: "test-key",
};

const run = () => sp500Close.run({ env, logger: createMockLogger() });

describe("sp500Close", () => {
  beforeEach(() => {
    daily = seriesFromCloses([100]);
    weekly = weeklyFromCloses([100]);
  });

  it("returns null when no bars are returned", async () => {
    daily = { ...seriesFromCloses([]), bars: [] };
    weekly = weeklyFromCloses([100]);

    expect(await run()).toBeNull();
  });

  it("flags an all-time high when the latest close ties the ATH", async () => {
    daily = seriesFromCloses([120, 110]);
    weekly = weeklyFromCloses([120, 90]);

    const message = await run();

    expect(message).toContain("all-time high");
    expect(message).toContain("$120.00");
  });

  it("uses the weekly history for the ATH baseline", async () => {
    // Latest daily close 90, but the weekly high is 150 → −40% from ATH.
    daily = seriesFromCloses([90, 95]);
    weekly = weeklyFromCloses([150, 120]);

    const message = await run();

    expect(message).not.toContain("all-time high");
    expect(message).toContain("−40.0%");
    expect(message).toContain("$150.00");
  });

  it("lets a fresh daily high beat the weekly baseline", async () => {
    // Recent daily high 160 exceeds the weekly high 150 → new ATH.
    daily = seriesFromCloses([160, 140]);
    weekly = weeklyFromCloses([150, 120]);

    const message = await run();

    expect(message).toContain("all-time high");
  });

  it("ignores an overlapping weekly bar dated inside the daily window", async () => {
    // A weekly bar dated within the July daily window must not seed the ATH —
    // only the daily closes cover that period. Weekly's high (200) shares the
    // latest daily date, so it is excluded; the ATH is the daily high, 100.
    daily = seriesFromCloses([100, 95]);
    weekly = {
      ...seriesFromCloses([200]),
      symbol: "SPY",
    };

    const message = await run();

    expect(message).toContain("all-time high");
    expect(message).not.toContain("200");
  });
});
