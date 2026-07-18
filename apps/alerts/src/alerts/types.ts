import type { AlphaVantageClient } from "@repo/alpha-vantage";
import type { Logger } from "@repo/logger";

import type { Env } from "../types/env";

type AlertContext = {
  env: Env;
  logger: Logger;
  /**
   * Shared Alpha Vantage client for the run. Constructed once by the scheduled
   * handler so alerts fetching the same series de-duplicate to one HTTP request
   * (see `AlphaVantageClient`), staying under the free-tier burst limit.
   */
  alphaVantage: AlphaVantageClient;
};

type Alert = {
  /** Human-readable identifier, used in logs. */
  name: string;
  /**
   * The cron expression this alert runs on. Must also appear in
   * `wrangler.jsonc` `triggers.crons`; the scheduled handler only runs alerts
   * whose `cron` matches the fired `event.cron`.
   */
  cron: string;
  /**
   * Produce the message to send, or `null` to send nothing this run (e.g. a
   * monitor with no change to report).
   */
  run: (ctx: AlertContext) => Promise<string | null>;
};

export type { Alert, AlertContext };
