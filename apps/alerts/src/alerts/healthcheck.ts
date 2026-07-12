import type { Alert } from "./types";

/**
 * Stage-1 alert: a simple daily heartbeat confirming the alerts worker runs on
 * schedule. Serves as the reference implementation for future alerts.
 */
const healthcheck: Alert = {
  name: "healthcheck",
  cron: "0 8 * * *",
  run: () => {
    const now = new Date().toISOString();
    return Promise.resolve(`✅ alerts worker healthy — ${now}`);
  },
};

export { healthcheck };
