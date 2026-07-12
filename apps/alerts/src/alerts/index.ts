import { healthcheck } from "./healthcheck";
import type { Alert } from "./types";

/**
 * The registry of alerts. Add new alerts here; remember to also add each
 * alert's `cron` to `wrangler.jsonc` `triggers.crons`.
 */
const alerts: Alert[] = [healthcheck];

export { alerts };
