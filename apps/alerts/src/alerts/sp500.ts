import type { AlphaVantageClient } from "@repo/alpha-vantage";
import type { DailyBar } from "@repo/alpha-vantage/types";

/** The S&P 500 ETF symbol both SP500 alerts track. */
const SP500_SYMBOL = "SPY";

type Sp500Data = {
  /** Recent daily bars (free `compact` history), newest-first. */
  bars: DailyBar[];
  /**
   * All-time-high baseline from the free weekly series, covering only the weeks
   * that ended *before* the daily `compact` window begins. The daily bars cover
   * the recent window precisely, so the effective ATH is
   * `Math.max(priorHigh, <the relevant daily closes>)`.
   *
   * Two important consequences of the date cutoff:
   * - No overlap/double-counting with the daily bars.
   * - Today's close never leaks into `priorHigh`, so a caller can derive a
   *   contamination-free "as of yesterday" high by slicing the daily bars —
   *   otherwise the current (still-forming) weekly bar, whose close tracks the
   *   latest daily close, would inflate an all-but-today high.
   *
   * Caveat: a weekly close is the week's last trading day, so a record *daily*
   * close made mid-week and older than the daily window is approximated by that
   * week's (possibly lower) close. Accepted — the deployment alerts treat this
   * as a drawdown-from-weekly-closing-high approximation.
   */
  priorHigh: number;
};

/**
 * Fetches the data both SP500 alerts need without the now-premium
 * `TIME_SERIES_DAILY&outputsize=full` endpoint: the free daily `compact` series
 * for precise recent closes, plus the free weekly series to establish the
 * all-time high. Two independent API calls per alert; well within the free tier.
 * If either call fails the whole fetch rejects, so the alert sends nothing
 * rather than acting on partial data.
 */
const fetchSp500 = async (client: AlphaVantageClient): Promise<Sp500Data> => {
  const [daily, weekly] = await Promise.all([
    client.getDailyTimeSeries(SP500_SYMBOL, { outputSize: "compact" }),
    client.getWeeklyTimeSeries(SP500_SYMBOL),
  ]);

  // Oldest daily bar (bars are newest-first) marks where the daily window
  // starts; only count weekly closes from strictly before it.
  const earliestDailyDate = daily.bars.at(-1)?.date;
  const priorHigh = weekly.bars
    .filter(
      (bar) => earliestDailyDate === undefined || bar.date < earliestDailyDate
    )
    .reduce((max, bar) => (bar.close > max ? bar.close : max), 0);

  return { bars: daily.bars, priorHigh };
};

export { fetchSp500, SP500_SYMBOL };
export type { Sp500Data };
