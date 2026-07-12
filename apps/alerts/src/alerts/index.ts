import { healthcheck } from "./healthcheck";
import { sp500Close } from "./sp500-close";
import { sp500Drawdown } from "./sp500-drawdown";
import type { Alert } from "./types";

/**
 * The registry of alerts. Add new alerts here; remember to also add each
 * alert's `cron` to `wrangler.jsonc` `triggers.crons`.
 */
const alerts: Alert[] = [healthcheck, sp500Close, sp500Drawdown];

export { alerts };
