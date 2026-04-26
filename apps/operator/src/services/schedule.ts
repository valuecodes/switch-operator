import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";

import { schedules } from "../db/schema";

const SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

const MAX_ACTIVE_SCHEDULES = 20;
const MAX_RETRIES = 3;

// A claim is treated as abandoned if it's older than this threshold,
// allowing another worker to re-claim the row after a crashed/timed-out run.
const STALE_LOCK_MS = 10 * 60 * 1000;

type ClaimedSchedule = typeof schedules.$inferSelect & { claimedAt: string };

const createScheduleSchema = z
  .object({
    scheduleType: z.enum(SCHEDULE_TYPES),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    timezone: z.string().refine(
      (tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid timezone" }
    ),
    fixedMessage: z.string().max(4000).optional(),
    messagePrompt: z.string().max(500).optional(),
    sourceUrl: z.string().max(2048).optional(),
    keywords: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
    description: z.string().max(200),
  })
  .refine(
    (d) => {
      if (d.sourceUrl) {
        return d.messagePrompt != null && d.fixedMessage == null;
      }
      return (d.fixedMessage != null) !== (d.messagePrompt != null);
    },
    {
      message:
        "Reminders need exactly one of fixedMessage/messagePrompt. Monitors need sourceUrl + messagePrompt, no fixedMessage.",
    }
  )
  .refine((d) => !d.keywords?.length || d.sourceUrl != null, {
    message: "keywords can only be used with monitors (sourceUrl must be set)",
  })
  .refine((d) => d.scheduleType === "hourly" || d.hour != null, {
    message: "hour is required for daily/weekly/monthly schedules",
  })
  .refine((d) => d.scheduleType !== "weekly" || d.dayOfWeek != null, {
    message: "dayOfWeek is required for weekly schedules",
  })
  .refine((d) => d.scheduleType !== "monthly" || d.dayOfMonth != null, {
    message: "dayOfMonth is required for monthly schedules",
  });

type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Get the current local parts (hour, minute, day-of-week, day-of-month, etc.)
 * for a given Date in a given timezone.
 */
const getLocalParts = (date: Date, timezone: string) => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dayOfWeek: WEEKDAY_MAP[parts.weekday] ?? 0,
  };
};

/**
 * Build a UTC Date from local parts in a given timezone.
 * Uses the timezone offset to convert local -> UTC.
 */
const localToUtc = (
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date => {
  // Start with a guess: treat local parts as UTC
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Find the offset by checking what local time the guess maps to
  const localParts = getLocalParts(guess, timezone);
  const localAsUtc = new Date(
    Date.UTC(
      localParts.year,
      localParts.month - 1,
      localParts.day,
      localParts.hour,
      localParts.minute,
      localParts.second,
      0
    )
  );

  const offsetMs = localAsUtc.getTime() - guess.getTime();
  const result = new Date(guess.getTime() - offsetMs);

  // Verify by round-tripping: the result, viewed in the target timezone,
  // should show the desired hour. If DST caused a shift (spring-forward),
  // the hour won't match — advance by 1 hour.
  const verify = getLocalParts(result, timezone);
  if (verify.hour !== hour) {
    // Spring-forward: the target hour doesn't exist. Advance to the next valid hour.
    const diff = ((hour - verify.hour + 24) % 24) * 60 * 60 * 1000;
    return new Date(result.getTime() + diff);
  }

  return result;
};

const computeNextRun = (
  scheduleType: ScheduleType,
  timezone: string,
  from: Date,
  opts: {
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
  }
): Date => {
  const minute = opts.minute ?? 0;

  if (scheduleType === "hourly") {
    // Next occurrence of :MM after `from`
    const local = getLocalParts(from, timezone);
    if (local.minute < minute) {
      // Still in the current hour
      return localToUtc(
        timezone,
        local.year,
        local.month,
        local.day,
        local.hour,
        minute
      );
    }
    // Next hour
    const next = new Date(from.getTime() + 60 * 60 * 1000);
    const nextLocal = getLocalParts(next, timezone);
    return localToUtc(
      timezone,
      nextLocal.year,
      nextLocal.month,
      nextLocal.day,
      nextLocal.hour,
      minute
    );
  }

  const hour = opts.hour ?? 0;

  if (scheduleType === "daily") {
    const local = getLocalParts(from, timezone);
    // Try today
    const candidate = localToUtc(
      timezone,
      local.year,
      local.month,
      local.day,
      hour,
      minute
    );
    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
    // Tomorrow
    const tomorrow = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const tLocal = getLocalParts(tomorrow, timezone);
    return localToUtc(
      timezone,
      tLocal.year,
      tLocal.month,
      tLocal.day,
      hour,
      minute
    );
  }

  if (scheduleType === "weekly") {
    const targetDay = opts.dayOfWeek ?? 0;
    const local = getLocalParts(from, timezone);

    // Try this week
    let daysAhead = (targetDay - local.dayOfWeek + 7) % 7;
    if (daysAhead === 0) {
      // Same day — check if time hasn't passed
      const candidate = localToUtc(
        timezone,
        local.year,
        local.month,
        local.day,
        hour,
        minute
      );
      if (candidate.getTime() > from.getTime()) {
        return candidate;
      }
      daysAhead = 7;
    }

    const target = new Date(from.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const tLocal = getLocalParts(target, timezone);
    return localToUtc(
      timezone,
      tLocal.year,
      tLocal.month,
      tLocal.day,
      hour,
      minute
    );
  }

  // monthly
  const targetDom = opts.dayOfMonth ?? 1;
  const local = getLocalParts(from, timezone);

  // Try this month
  if (local.day <= targetDom) {
    const candidate = localToUtc(
      timezone,
      local.year,
      local.month,
      targetDom,
      hour,
      minute
    );
    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }

  // Next month
  let nextMonth = local.month + 1;
  let nextYear = local.year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear++;
  }
  return localToUtc(timezone, nextYear, nextMonth, targetDom, hour, minute);
};

class ScheduleService {
  private readonly db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async create(chatId: number, input: CreateScheduleInput) {
    const validated = createScheduleSchema.parse(input);
    const now = new Date();
    const nextRunAt = computeNextRun(
      validated.scheduleType,
      validated.timezone,
      now,
      {
        hour: validated.hour,
        minute: validated.minute,
        dayOfWeek: validated.dayOfWeek,
        dayOfMonth: validated.dayOfMonth,
      }
    );

    const [row] = await this.db
      .insert(schedules)
      .values({
        chatId,
        scheduleType: validated.scheduleType,
        hour: validated.hour,
        minute: validated.minute ?? 0,
        dayOfWeek: validated.dayOfWeek,
        dayOfMonth: validated.dayOfMonth,
        timezone: validated.timezone,
        fixedMessage: validated.fixedMessage,
        messagePrompt: validated.messagePrompt,
        sourceUrl: validated.sourceUrl,
        keywords: validated.keywords?.length
          ? JSON.stringify(validated.keywords)
          : undefined,
        description: validated.description,
        nextRunAt: nextRunAt.toISOString(),
      })
      .returning();

    return row;
  }

  async list(chatId: number) {
    return this.db
      .select()
      .from(schedules)
      .where(and(eq(schedules.chatId, chatId), eq(schedules.active, true)));
  }

  async countActive(chatId: number): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schedules)
      .where(and(eq(schedules.chatId, chatId), eq(schedules.active, true)));
    return result.count;
  }

  async remove(id: string, chatId: number): Promise<boolean> {
    const result = await this.db
      .update(schedules)
      .set({ active: false })
      .where(and(eq(schedules.id, id), eq(schedules.chatId, chatId)));
    return result.meta.changes > 0;
  }

  /**
   * Claim due schedules for a specific chat by acquiring a lock
   * (claimed_at). next_run_at is NOT advanced here — that happens only
   * after execution succeeds (or retries are exhausted), so an ambiguous
   * D1 outcome can't silently drop an occurrence. Stale locks (older than
   * STALE_LOCK_MS) are reclaimable to recover from crashed runs.
   */
  async claimDueSchedules(
    now: Date,
    allowedChatId: string
  ): Promise<ClaimedSchedule[]> {
    const nowIso = now.toISOString();
    const staleBeforeIso = new Date(
      now.getTime() - STALE_LOCK_MS
    ).toISOString();
    const chatIdNum = Number(allowedChatId);

    const dueRows = await this.db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.active, true),
          lte(schedules.nextRunAt, nowIso),
          eq(schedules.chatId, chatIdNum),
          or(
            isNull(schedules.claimedAt),
            lt(schedules.claimedAt, staleBeforeIso)
          )
        )
      );

    if (dueRows.length === 0) {
      return [];
    }

    const claimed: ClaimedSchedule[] = [];
    for (const row of dueRows) {
      const lockGuard =
        row.claimedAt === null
          ? isNull(schedules.claimedAt)
          : eq(schedules.claimedAt, row.claimedAt);
      const result = await this.db
        .update(schedules)
        .set({ claimedAt: nowIso })
        .where(and(eq(schedules.id, row.id), lockGuard));
      if (result.meta.changes > 0) {
        claimed.push({ ...row, claimedAt: nowIso });
      }
    }

    return claimed;
  }

  async markFailed(row: ClaimedSchedule, now: Date) {
    const newCount = row.retryCount + 1;
    const exhausted = newCount >= MAX_RETRIES;

    const update = exhausted
      ? {
          // Skip this slot, reset for the next regular occurrence.
          nextRunAt: this.nextOccurrence(row, now).toISOString(),
          retryCount: 0,
          claimedAt: null,
        }
      : {
          retryCount: newCount,
          nextRunAt: new Date(
            now.getTime() + newCount * 2 * 60 * 1000
          ).toISOString(),
          claimedAt: null,
        };

    const result = await this.db
      .update(schedules)
      .set(update)
      .where(
        and(eq(schedules.id, row.id), eq(schedules.claimedAt, row.claimedAt))
      );

    if (result.meta.changes === 0) {
      return { exhausted: false, lockLost: true };
    }
    return { exhausted, lockLost: false };
  }

  async markSuccess(row: ClaimedSchedule, now: Date) {
    const result = await this.db
      .update(schedules)
      .set({
        nextRunAt: this.nextOccurrence(row, now).toISOString(),
        retryCount: 0,
        claimedAt: null,
      })
      .where(
        and(eq(schedules.id, row.id), eq(schedules.claimedAt, row.claimedAt))
      );
    return { lockLost: result.meta.changes === 0 };
  }

  private nextOccurrence(row: ClaimedSchedule, now: Date): Date {
    return computeNextRun(row.scheduleType, row.timezone, now, {
      hour: row.hour ?? undefined,
      minute: row.minute ?? undefined,
      dayOfWeek: row.dayOfWeek ?? undefined,
      dayOfMonth: row.dayOfMonth ?? undefined,
    });
  }

  async updateState(id: string, stateJson: string) {
    const STATE_MAX_BYTES = 100 * 1024;
    if (new TextEncoder().encode(stateJson).byteLength > STATE_MAX_BYTES) {
      throw new Error("stateJson exceeds 100KB limit");
    }
    await this.db
      .update(schedules)
      .set({ stateJson })
      .where(eq(schedules.id, id));
  }
}

export {
  computeNextRun,
  createScheduleSchema,
  MAX_ACTIVE_SCHEDULES,
  MAX_RETRIES,
  SCHEDULE_TYPES,
  ScheduleService,
};
export type { CreateScheduleInput, ScheduleType };
