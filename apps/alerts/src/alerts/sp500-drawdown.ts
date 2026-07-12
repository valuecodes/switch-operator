import { AlphaVantageClient } from "@repo/alpha-vantage";
import type { DailyBar } from "@repo/alpha-vantage/types";

import type { Alert } from "./types";

/**
 * Drawdown thresholds (fractions of the all-time high) to watch. Adjust this
 * list to change which levels trigger an alert — e.g. add `0.05` or drop `0.5`.
 */
const DRAWDOWN_THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5];

/**
 * The deepest threshold the drawdown has breached (`dd >= T`), or `0` when the
 * price is above every threshold. Two closes in the same band mean no crossing.
 */
const bandFor = (drawdown: number): number => {
  let band = 0;
  for (const threshold of DRAWDOWN_THRESHOLDS) {
    if (drawdown >= threshold) {
      band = threshold;
    }
  }
  return band;
};

/** All-time high close across the given bars. */
const highClose = (bars: DailyBar[]): number =>
  bars.reduce((max, bar) => (bar.close > max ? bar.close : max), 0);

const formatPercent = (fraction: number): string =>
  `${Math.round(fraction * 100)}%`;

/**
 * Alerts when the S&P 500 (via SPY) crosses a drawdown threshold relative to its
 * all-time-high daily close — in either direction. Detection is stateless: it
 * compares the two most recent daily closes, so a crossing is reported exactly
 * once, on the day the drawdown band changes. The alert runs at 08:00 UTC
 * (before the US open), so both bars are always completed closes.
 *
 * Trade-off: if the worker misses a scheduled run, a crossing that happened on
 * the skipped trading day is not reported. Accepted to avoid adding persistence.
 */
const sp500Drawdown: Alert = {
  name: "sp500-drawdown",
  cron: "0 8 * * *", // reuses the existing daily 08:00 UTC trigger
  run: async ({ env, logger }) => {
    const client = new AlphaVantageClient(env.ALPHA_VANTAGE_API_KEY, logger);
    // `full` history is required to establish a real all-time high.
    const series = await client.getDailyTimeSeries("SPY", {
      outputSize: "full",
    });

    if (series.bars.length < 2) {
      logger.warn("need at least 2 SPY bars for drawdown", {
        symbol: series.symbol,
        count: series.bars.length,
      });
      return null;
    }

    // Bars are newest-first: [0] is today's close, [1] is the prior close.
    const [today, prev] = series.bars;

    const athToday = highClose(series.bars);
    const athPrev = highClose(series.bars.slice(1));

    const ddToday = (athToday - today.close) / athToday;
    const ddPrev = (athPrev - prev.close) / athPrev;

    const bandToday = bandFor(ddToday);
    const bandPrev = bandFor(ddPrev);

    if (bandToday === bandPrev) {
      return null;
    }

    if (bandToday > bandPrev) {
      // Market fell through one or more thresholds since the prior close.
      const crossed = DRAWDOWN_THRESHOLDS.filter(
        (t) => t > bandPrev && t <= bandToday
      );
      const levels = crossed.map(formatPercent).join(", ");
      return [
        `📉 S&P 500 fell below <b>${levels}</b> from its all-time high`,
        `${today.date}: SPY $${today.close.toFixed(2)} (−${formatPercent(ddToday)} from ATH $${athToday.toFixed(2)})`,
      ].join("\n");
    }

    // Market recovered back above one or more thresholds.
    const crossed = DRAWDOWN_THRESHOLDS.filter(
      (t) => t > bandToday && t <= bandPrev
    );
    const levels = crossed.map(formatPercent).join(", ");
    return [
      `📈 S&P 500 recovered above <b>${levels}</b> from its all-time high`,
      `${today.date}: SPY $${today.close.toFixed(2)} (−${formatPercent(ddToday)} from ATH $${athToday.toFixed(2)})`,
    ].join("\n");
  },
};

export { sp500Drawdown, DRAWDOWN_THRESHOLDS };
