import { AlphaVantageClient } from "@repo/alpha-vantage";
import type { DailyBar } from "@repo/alpha-vantage/types";

import type { Alert } from "./types";

/**
 * Reports the latest daily close for SPY (the S&P 500 ETF). Doubles as the
 * reference implementation for wiring `@repo/alpha-vantage` into an alert.
 */
const sp500Close: Alert = {
  name: "sp500-close",
  cron: "0 8 * * *", // reuses the existing daily 08:00 UTC trigger
  run: async ({ env, logger }) => {
    const client = new AlphaVantageClient(env.ALPHA_VANTAGE_API_KEY, logger);
    // `full` history is required to establish a real all-time high.
    const series = await client.getDailyTimeSeries("SPY", {
      outputSize: "full",
    });
    if (series.bars.length === 0) {
      logger.warn("no SPY bars returned", { symbol: series.symbol });
      return null;
    }

    const latest = series.bars[0];
    // The bar with the highest close; `latest` is at the ATH when it ties it.
    const athBar = series.bars.reduce((max: DailyBar, bar: DailyBar) =>
      bar.close > max.close ? bar : max
    );
    const isNewAth = latest.close >= athBar.close;

    const head = `📈 SPY close ${latest.date}: $${latest.close.toFixed(2)}`;
    if (isNewAth) {
      return `${head} — 🚀 all-time high`;
    }

    const drawdown = (athBar.close - latest.close) / athBar.close;
    return `${head} (−${(drawdown * 100).toFixed(1)}% from ATH $${athBar.close.toFixed(2)} on ${athBar.date})`;
  },
};

export { sp500Close };
