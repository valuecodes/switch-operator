import { AlphaVantageClient } from "@repo/alpha-vantage";
import type { DailyBar, DailyTimeSeries } from "@repo/alpha-vantage/types";
import type { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sp500Drawdown } from "./sp500-drawdown";

// The alert (via `fetchSp500`) calls both `getDailyTimeSeries` (recent closes)
// and `getWeeklyTimeSeries` (historical ATH baseline). Both are controlled
// per-test. The default weekly baseline is well below the daily ATH, so the
// daily series drives the classic cases; the last two tests exercise the
// weekly baseline and the date-cutoff that keeps today out of it.
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

/**
 * Build a newest-first daily series from `closes` (index 0 is the latest close,
 * dated 2026-07-11). Only `date`/`close` matter to the alert; other OHLCV
 * fields are filler.
 */
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
 * daily window, so `fetchSp500` counts them as the historical baseline.
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

const run = () => {
  const logger = createMockLogger();
  const alphaVantage = new AlphaVantageClient("test-key", logger);
  return sp500Drawdown.run({ env, logger, alphaVantage });
};

describe("sp500Drawdown", () => {
  beforeEach(() => {
    daily = seriesFromCloses([100]);
    // Low historical baseline: below the in-daily ATH, so the daily series
    // drives the classic cases below.
    weekly = weeklyFromCloses([50]);
  });

  it("returns null when both closes are in the same drawdown band", async () => {
    // ATH 100; today −8%, prev −7% → both sit in the 5% band, no crossing.
    daily = seriesFromCloses([92, 93, 100]);

    expect(await run()).toBeNull();
  });

  it("returns null with fewer than two bars", async () => {
    daily = seriesFromCloses([95]);

    expect(await run()).toBeNull();
  });

  it("reports a downward crossing of a single level with deploy guidance", async () => {
    // ATH 100; prev −8% (band 5%) → today −12% (band 10%).
    daily = seriesFromCloses([88, 92, 100]);

    const message = await run();

    expect(message).toContain("CORRECTION");
    expect(message).toContain("Deploy");
    expect(message).toContain("15%");
    expect(message).toContain("2026-07-11");
  });

  it("reports a recovery back above a level with refill guidance", async () => {
    // ATH 100; prev −12% (band 10%) → today −8% (band 5%).
    daily = seriesFromCloses([92, 88, 100]);

    const message = await run();

    expect(message).toContain("REBOUND");
    expect(message).toContain("Rebuild");
    expect(message).toContain("15%");
  });

  it("sums the deploy amounts for every level crossed in a single-day move", async () => {
    // ATH 100; prev −8% (band 5%) → today −22% (band 20%): crosses 10% and 20%.
    daily = seriesFromCloses([78, 92, 100]);

    const message = await run();

    expect(message).toContain("BEAR MARKET");
    expect(message).toContain("Deploy");
    expect(message).toContain("45%"); // 15% + 30%
  });

  it("pings the 5% dip with no deploy guidance", async () => {
    // ATH 100; prev −3% (band 0) → today −6% (band 5%, deploy 0).
    daily = seriesFromCloses([94, 97, 100]);

    const message = await run();

    expect(message).toContain("DIP");
    expect(message).toContain("keep your powder dry");
    expect(message).not.toContain("Deploy");
  });

  it("returns null when today prints a new all-time high", async () => {
    // Both closes are at/above the prior high → drawdown 0, same band.
    daily = seriesFromCloses([105, 100, 90]);

    expect(await run()).toBeNull();
  });

  it("drives the drawdown off the weekly ATH when it exceeds recent closes", async () => {
    // Recent daily closes sit below a historical weekly high of 200: today
    // −25% (band 20%), prev −7.5% (band 5%) → crosses 10% and 20% (BEAR).
    daily = seriesFromCloses([150, 185]);
    weekly = weeklyFromCloses([200, 180]);

    const message = await run();

    expect(message).toContain("BEAR MARKET");
    expect(message).toContain("45%"); // 15% + 30%
    expect(message).toContain("$200.00"); // ATH sourced from weekly history
  });

  it("keeps today out of the ATH baseline (no false rebound on a new high)", async () => {
    // Today prints a fresh high (130) after a flat prior close (100). A weekly
    // bar dated on today's date carries that 130 — if it leaked into the
    // baseline, `athPrev` would inflate to 130 and fabricate a REBOUND. The
    // date cutoff excludes it, so only the June baseline (100) counts → no
    // crossing.
    daily = seriesFromCloses([130, 100, 100]);
    weekly = {
      symbol: "SPY",
      lastRefreshed: "2026-07-11",
      timeZone: "US/Eastern",
      bars: [
        {
          date: "2026-07-11", // overlaps the daily window → must be ignored
          open: 130,
          high: 130,
          low: 130,
          close: 130,
          volume: 5_000_000,
        },
        {
          date: "2026-06-26",
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 5_000_000,
        },
      ],
    };

    expect(await run()).toBeNull();
  });
});
