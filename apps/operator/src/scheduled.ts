import { Logger } from "@repo/logger";

import { OpenAiService } from "./services/openai";
import { ScheduleService } from "./services/schedule";
import { scrapeUrl } from "./services/scrape";
import { TelegramService } from "./services/telegram";
import type { AppEnv } from "./types/env";
import { splitMessage } from "./utils/message";
import { validateSourceUrl } from "./utils/url-validator";

type Env = AppEnv["Bindings"];

const RESPONSE_SIZE_LIMIT = 1024 * 1024; // 1MB

const handleScheduled = async (
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
) => {
  const logger = new Logger({ context: "scheduled", level: "info" });
  const now = new Date();

  const scheduleService = new ScheduleService(env.DB);
  const telegram = new TelegramService(env.TELEGRAM_BOT_TOKEN, logger);

  let claimed;
  try {
    claimed = await scheduleService.claimDueSchedules(now, env.ALLOWED_CHAT_ID);
  } catch (error) {
    logger.error("failed to claim due schedules", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (claimed.length === 0) {
    return;
  }

  logger.info("claimed schedules", { count: claimed.length });

  const chatId = Number(env.ALLOWED_CHAT_ID);

  const results = await Promise.allSettled(
    claimed.map(async (schedule) => {
      // Monitor path
      if (schedule.sourceUrl) {
        const urlCheck = validateSourceUrl(schedule.sourceUrl);
        if (!urlCheck.valid) {
          logger.error("monitor URL validation failed at execution", {
            scheduleId: schedule.id,
            reason: urlCheck.reason,
          });
          return;
        }

        const scrapeResult = await scrapeUrl(schedule.sourceUrl);
        if (!scrapeResult.ok) {
          throw new Error(`Scrape failed: ${scrapeResult.error}`);
        }

        const previousState = schedule.stateJson
          ? (JSON.parse(schedule.stateJson) as { lastContent: string })
              .lastContent
          : null;

        const openai = new OpenAiService(env.OPENAI_API_KEY, logger);
        const analysis = await openai.analyzeMonitor({
          task: schedule.messagePrompt ?? schedule.description,
          scrapedContent: scrapeResult.text,
          previousState,
        });

        if (analysis.notify) {
          for (const chunk of splitMessage(analysis.message)) {
            await telegram.sendMessage({ chat_id: chatId, text: chunk });
          }
          logger.info("monitor notification sent", {
            scheduleId: schedule.id,
          });
        } else {
          logger.info("monitor check — no notification needed", {
            scheduleId: schedule.id,
          });
        }

        await scheduleService.updateState(
          schedule.id,
          JSON.stringify({
            lastContent: analysis.newState,
            lastScrapedAt: now.toISOString(),
          })
        );
        return;
      }

      // Reminder path
      let text: string;
      if (schedule.fixedMessage) {
        text = schedule.fixedMessage;
      } else if (schedule.messagePrompt) {
        const openai = new OpenAiService(env.OPENAI_API_KEY, logger);
        text = await openai.reply(schedule.messagePrompt);
        if (text.length > RESPONSE_SIZE_LIMIT) {
          text = text.slice(0, RESPONSE_SIZE_LIMIT);
        }
      } else {
        logger.warn("schedule has no message content", {
          scheduleId: schedule.id,
        });
        return;
      }

      for (const chunk of splitMessage(text)) {
        await telegram.sendMessage({ chat_id: chatId, text: chunk });
      }

      logger.info("scheduled message sent", {
        scheduleId: schedule.id,
        type: schedule.scheduleType,
      });
    })
  );

  // Handle failures — mark for retry
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const schedule = claimed[i];
    if (result.status === "fulfilled") {
      await scheduleService.markSuccess(schedule.id);
    }

    if (result.status === "rejected") {
      logger.error("scheduled message failed", {
        scheduleId: schedule.id,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });

      const { deadLettered } = await scheduleService.markFailed(
        schedule.id,
        schedule.retryCount
      );
      if (deadLettered) {
        logger.error("schedule dead-lettered after max retries", {
          scheduleId: schedule.id,
        });
      }
    }
  }
};

const createScheduledHandler = () => {
  return (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  };
};

export { createScheduledHandler, handleScheduled };
