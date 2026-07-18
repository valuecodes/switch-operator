import { AlphaVantageClient } from "@repo/alpha-vantage";

import { fetchSp500, SP500_SYMBOL } from "./sp500";
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
    // Free daily `compact` closes + the free weekly series for the ATH baseline
    // (daily `full` history is a premium feature). See `fetchSp500`.
    const { bars, priorHigh } = await fetchSp500(client);
    if (bars.length === 0) {
      logger.warn("no SPY bars returned", { symbol: SP500_SYMBOL });
      return null;
    }

    const latest = bars[0];
    // All-time high close: the highest weekly *close* from prior history,
    // lifted by any fresher close among the recent daily bars.
    const ath = bars.reduce((max, bar) => Math.max(max, bar.close), priorHigh);
    const isNewAth = latest.close >= ath;

    const head = `📈 SPY close ${latest.date}: $${latest.close.toFixed(2)}`;
    if (isNewAth) {
      return `${head} — 🚀 all-time high`;
    }

    const drawdown = (ath - latest.close) / ath;
    return `${head} (−${(drawdown * 100).toFixed(1)}% from ATH $${ath.toFixed(2)})`;
  },
};

export { sp500Close };
