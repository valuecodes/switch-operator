import { AlphaVantageClient } from "@repo/alpha-vantage";
import type { DailyBar } from "@repo/alpha-vantage/types";

import type { Alert } from "./types";

type DrawdownLevel = {
  /** Drawdown from the all-time high (fraction) that triggers this level. */
  threshold: number;
  /** Fraction of the *original* cash reserve to deploy when crossing down. */
  deploy: number;
  /** Punchy headline, escalating with severity. */
  headline: string;
};

/**
 * Drawdown levels to watch, with the staged cash-reserve deployment plan. Adjust
 * this list to change thresholds, deploy amounts, or copy. `deploy` values are
 * fractions of the original reserve and sum to 1.0 by the −50% level; the −5%
 * level is an informational "dip" ping with no deployment.
 */
const DRAWDOWN_LEVELS: DrawdownLevel[] = [
  { threshold: 0.05, deploy: 0, headline: "💧 DIP" },
  { threshold: 0.1, deploy: 0.15, headline: "📉 CORRECTION" },
  { threshold: 0.2, deploy: 0.3, headline: "🐻 BEAR MARKET" },
  { threshold: 0.3, deploy: 0.3, headline: "🔥 CRASH" },
  { threshold: 0.4, deploy: 0.2, headline: "💥 MELTDOWN" },
  { threshold: 0.5, deploy: 0.05, headline: "☢️ CAPITULATION" },
];

/**
 * The deepest level the drawdown has breached (`dd >= threshold`), or `0` when
 * the price is above every level. Two closes in the same band mean no crossing.
 */
const bandFor = (drawdown: number): number => {
  let band = 0;
  for (const level of DRAWDOWN_LEVELS) {
    if (drawdown >= level.threshold) {
      band = level.threshold;
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
 * Alerts when the S&P 500 (via SPY) crosses a drawdown level relative to its
 * all-time-high daily close — in either direction — and tells you how much of
 * your cash reserve to deploy (falling) or rebuild (recovering). Detection is
 * stateless: it compares the two most recent daily closes, so a crossing is
 * reported exactly once, on the day the drawdown band changes. The alert runs at
 * 08:00 UTC (before the US open), so both bars are always completed closes.
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

    const stats = `SPY $${today.close.toFixed(2)} on ${today.date} · ATH $${athToday.toFixed(2)} (−${formatPercent(ddToday)})`;

    if (bandToday > bandPrev) {
      // Market fell through one or more levels since the prior close.
      const crossed = DRAWDOWN_LEVELS.filter(
        (l) => l.threshold > bandPrev && l.threshold <= bandToday
      );
      const deepest = crossed[crossed.length - 1];
      const deploySum = crossed.reduce((sum, l) => sum + l.deploy, 0);
      const action =
        deploySum > 0
          ? `🫡 Deploy <b>${formatPercent(deploySum)}</b> of your original cash reserve`
          : `🧊 Just a dip — keep your powder dry`;
      return [
        `${deepest.headline} — <b>S&P 500 down ${formatPercent(bandToday)} from its all-time high!</b>`,
        stats,
        action,
      ].join("\n");
    }

    // Market recovered back above one or more levels.
    const crossed = DRAWDOWN_LEVELS.filter(
      (l) => l.threshold > bandToday && l.threshold <= bandPrev
    );
    // Deepest level reclaimed (crossed is ascending by threshold).
    const reclaimed = crossed[crossed.length - 1].threshold;
    const refillSum = crossed.reduce((sum, l) => sum + l.deploy, 0);
    const action =
      refillSum > 0
        ? `💰 Rebuild your cash reserve: add back <b>${formatPercent(refillSum)}</b>`
        : `🌤️ Storm passing — nothing to rebuild yet`;
    return [
      `📈 <b>REBOUND — S&P 500 back above ${formatPercent(reclaimed)} from its all-time high</b>`,
      stats,
      action,
    ].join("\n");
  },
};

export { sp500Drawdown, DRAWDOWN_LEVELS };
