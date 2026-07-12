import { Logger } from "@repo/logger";
import { TelegramService } from "@repo/telegram";

import { alerts } from "./alerts";
import { parseEnv } from "./types/env";

const handleScheduled = async (
  event: ScheduledEvent,
  env: unknown,
  _ctx: ExecutionContext
) => {
  const logger = new Logger({ context: "alerts", level: "info" });

  const parsed = parseEnv(env);
  const telegram = new TelegramService(parsed.TELEGRAM_BOT_TOKEN, logger);
  const chatId = Number(parsed.ALLOWED_CHAT_ID);

  const due = alerts.filter((alert) => alert.cron === event.cron);
  if (due.length === 0) {
    logger.info("no alerts for cron", { cron: event.cron });
    return;
  }

  logger.info("running alerts", { cron: event.cron, count: due.length });

  const results = await Promise.allSettled(
    due.map(async (alert) => {
      const message = await alert.run({ env: parsed, logger });
      if (message === null) {
        logger.info("alert produced no message", { alert: alert.name });
        return;
      }
      await telegram.sendMessage({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      });
      logger.info("alert message sent", { alert: alert.name });
    })
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      logger.error("alert failed", {
        alert: due[i].name,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  });
};

const createScheduledHandler = () => {
  return (event: ScheduledEvent, env: unknown, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  };
};

export { createScheduledHandler, handleScheduled };
