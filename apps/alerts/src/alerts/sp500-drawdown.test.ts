import type { DailyBar, DailyTimeSeries } from "@repo/alpha-vantage/types";
import type { Logger } from "@repo/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sp500Drawdown } from "./sp500-drawdown";

// The alert constructs `new AlphaVantageClient(...)` and calls
// `getDailyTimeSeries`; return a canned series controlled per-test.
let series: DailyTimeSeries;

vi.mock("@repo/alpha-vantage", () => ({
  AlphaVantageClient: class {
    getDailyTimeSeries = () => Promise.resolve(series);
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
 * Build a newest-first series from `closes` (index 0 is the latest close). Only
 * `date`/`close` matter to the alert; other OHLCV fields are filler.
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

const env = {
  TELEGRAM_BOT_TOKEN: "test-token",
  ALLOWED_CHAT_ID: "12345",
  ALPHA_VANTAGE_API_KEY: "test-key",
};

const run = () => sp500Drawdown.run({ env, logger: createMockLogger() });

describe("sp500Drawdown", () => {
  beforeEach(() => {
    series = seriesFromCloses([100]);
  });

  it("returns null when both closes are in the same drawdown band", async () => {
    // ATH 100; today −8%, prev −7% → both sit in the 5% band, no crossing.
    series = seriesFromCloses([92, 93, 100]);

    expect(await run()).toBeNull();
  });

  it("returns null with fewer than two bars", async () => {
    series = seriesFromCloses([95]);

    expect(await run()).toBeNull();
  });

  it("reports a downward crossing of a single level with deploy guidance", async () => {
    // ATH 100; prev −8% (band 5%) → today −12% (band 10%).
    series = seriesFromCloses([88, 92, 100]);

    const message = await run();

    expect(message).toContain("CORRECTION");
    expect(message).toContain("Deploy");
    expect(message).toContain("15%");
    expect(message).toContain("2026-07-11");
  });

  it("reports a recovery back above a level with refill guidance", async () => {
    // ATH 100; prev −12% (band 10%) → today −8% (band 5%).
    series = seriesFromCloses([92, 88, 100]);

    const message = await run();

    expect(message).toContain("REBOUND");
    expect(message).toContain("Rebuild");
    expect(message).toContain("15%");
  });

  it("sums the deploy amounts for every level crossed in a single-day move", async () => {
    // ATH 100; prev −8% (band 5%) → today −22% (band 20%): crosses 10% and 20%.
    series = seriesFromCloses([78, 92, 100]);

    const message = await run();

    expect(message).toContain("BEAR MARKET");
    expect(message).toContain("Deploy");
    expect(message).toContain("45%"); // 15% + 30%
  });

  it("pings the 5% dip with no deploy guidance", async () => {
    // ATH 100; prev −3% (band 0) → today −6% (band 5%, deploy 0).
    series = seriesFromCloses([94, 97, 100]);

    const message = await run();

    expect(message).toContain("DIP");
    expect(message).toContain("keep your powder dry");
    expect(message).not.toContain("Deploy");
  });

  it("returns null when today prints a new all-time high", async () => {
    // Both closes are at/above the prior high → drawdown 0, same band.
    series = seriesFromCloses([105, 100, 90]);

    expect(await run()).toBeNull();
  });
});
