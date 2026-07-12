import { AlphaVantageClient } from "@repo/alpha-vantage";

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
    const series = await client.getDailyTimeSeries("SPY");
    if (series.bars.length === 0) {
      logger.warn("no SPY bars returned", { symbol: series.symbol });
      return null;
    }
    const latest = series.bars[0];
    return `📈 SPY close ${latest.date}: $${latest.close.toFixed(2)}`;
  },
};

export { sp500Close };
