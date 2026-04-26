import { Logger } from "@repo/logger";

import { OpenAiService } from "./services/openai";
import { MAX_RETRIES, ScheduleService } from "./services/schedule";
import { scrapeUrl } from "./services/scrape";
import { TelegramService } from "./services/telegram";
import type { AppEnv } from "./types/env";
import {
  extractWindows,
  findKeywordPositions,
  parseKeywords,
} from "./utils/keywords";
import { markdownToTelegramHtml } from "./utils/markdown-to-html";
import {
  splitMessage,
  TELEGRAM_HTML_SAFE_LENGTH,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "./utils/message";
import { validateSourceUrl } from "./utils/url-validator";

type Env = AppEnv["Bindings"];

const RESPONSE_SIZE_LIMIT = 1024 * 1024; // 1MB

const describeErrorCause = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || error.cause === undefined) {
    return undefined;
  }
  const { cause } = error;
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return undefined;
  }
};

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
      cause: describeErrorCause(error),
    });
    return;
  }

  if (claimed.length === 0) {
    logger.info("no due schedules");
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

        let previousState: string | null = null;
        if (schedule.stateJson) {
          try {
            const parsed = JSON.parse(schedule.stateJson) as Record<
              string,
              unknown
            >;
            previousState =
              typeof parsed.lastContent === "string"
                ? parsed.lastContent
                : null;
          } catch {
            logger.warn("malformed stateJson, treating as first run", {
              scheduleId: schedule.id,
            });
          }
        }

        const sourceContent = scrapeResult.text;
        let scrapedContent = sourceContent;

        const keywords = parseKeywords(schedule.keywords);
        if (keywords.length > 0) {
          const positions = findKeywordPositions(sourceContent, keywords);
          if (positions.length === 0) {
            logger.info("monitor keyword check — no matches, skipping", {
              scheduleId: schedule.id,
            });
            const { lockLost } = await scheduleService.updateState(
              schedule,
              JSON.stringify({
                lastContent: `No keyword matches found in scraped content.${scrapeResult.truncated ? " Scraped content was truncated before keyword matching." : ""}`,
                lastScrapedAt: now.toISOString(),
              })
            );
            if (lockLost) {
              logger.warn(
                "lock lost during monitor execution; state update skipped",
                { scheduleId: schedule.id }
              );
            }
            return;
          }
          scrapedContent = extractWindows(sourceContent, positions, 2000);
        }

        if (scrapeResult.truncated) {
          scrapedContent +=
            "\n\n[Note: Page content was truncated. Analysis is based on partial content.]";
        }

        const openai = new OpenAiService(env.OPENAI_API_KEY, logger);
        const analysis = await openai.analyzeMonitor({
          task: schedule.messagePrompt ?? schedule.description,
          scrapedContent,
          previousState,
        });

        if (analysis.notify) {
          for (const chunk of splitMessage(
            analysis.message,
            TELEGRAM_HTML_SAFE_LENGTH
          )) {
            await telegram.sendMessage({
              chat_id: chatId,
              text: markdownToTelegramHtml(chunk),
              parse_mode: "HTML",
            });
          }
          logger.info("monitor notification sent", {
            scheduleId: schedule.id,
          });
        } else {
          logger.info("monitor check — no notification needed", {
            scheduleId: schedule.id,
          });
        }

        const { lockLost } = await scheduleService.updateState(
          schedule,
          JSON.stringify({
            lastContent: analysis.newState,
            lastScrapedAt: now.toISOString(),
          })
        );
        if (lockLost) {
          logger.warn(
            "lock lost during monitor execution; state update skipped",
            { scheduleId: schedule.id }
          );
        }
        return;
      }

      // Reminder path
      let text: string;
      let formatAsHtml = false;
      if (schedule.fixedMessage) {
        text = schedule.fixedMessage;
      } else if (schedule.messagePrompt) {
        const openai = new OpenAiService(env.OPENAI_API_KEY, logger);
        text = await openai.reply(schedule.messagePrompt);
        if (text.length > RESPONSE_SIZE_LIMIT) {
          text = text.slice(0, RESPONSE_SIZE_LIMIT);
        }
        formatAsHtml = true;
      } else {
        logger.warn("schedule has no message content", {
          scheduleId: schedule.id,
        });
        return;
      }

      const chunkMax = formatAsHtml
        ? TELEGRAM_HTML_SAFE_LENGTH
        : TELEGRAM_MAX_MESSAGE_LENGTH;
      for (const chunk of splitMessage(text, chunkMax)) {
        await telegram.sendMessage({
          chat_id: chatId,
          text: formatAsHtml ? markdownToTelegramHtml(chunk) : chunk,
          ...(formatAsHtml ? { parse_mode: "HTML" as const } : {}),
        });
      }

      logger.info("scheduled message sent", {
        scheduleId: schedule.id,
        type: schedule.scheduleType,
      });
    })
  );

  // Handle failures — mark for retry
  const completionTime = new Date();
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const schedule = claimed[i];
    if (result.status === "fulfilled") {
      const { lockLost } = await scheduleService.markSuccess(schedule);
      if (lockLost) {
        logger.warn("lock lost before recording success", {
          scheduleId: schedule.id,
        });
      }
    }

    if (result.status === "rejected") {
      logger.error("scheduled message failed", {
        scheduleId: schedule.id,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });

      const { exhausted, lockLost } = await scheduleService.markFailed(
        schedule,
        completionTime
      );
      if (lockLost) {
        logger.warn("lock lost before recording failure", {
          scheduleId: schedule.id,
        });
        continue;
      }
      if (exhausted) {
        logger.warn("schedule retries exhausted, skipping until next run", {
          scheduleId: schedule.id,
        });
        try {
          await telegram.sendMessage({
            chat_id: chatId,
            text: `⚠️ Schedule "${schedule.description}" failed ${String(MAX_RETRIES)} times — skipping until next run.`,
          });
        } catch (notifyErr) {
          logger.error("failed to send retry-exhaustion notification", {
            scheduleId: schedule.id,
            error:
              notifyErr instanceof Error
                ? notifyErr.message
                : String(notifyErr),
          });
        }
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
