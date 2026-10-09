import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";

import { schedules } from "~/db/schema";

import { computeNextRun, SCHEDULE_TYPES } from "./schedule-time";

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
    useBrowser: z.boolean().optional(),
    description: z.string().max(200),
  })
  .refine(
    (d) => {
      if (d.sourceUrl !== undefined && d.sourceUrl !== "") {
        return d.messagePrompt !== undefined && d.fixedMessage === undefined;
      }
      return (d.fixedMessage !== undefined) !== (d.messagePrompt !== undefined);
    },
    {
      message:
        "Reminders need exactly one of fixedMessage/messagePrompt. Monitors need sourceUrl + messagePrompt, no fixedMessage.",
    }
  )
  .refine((d) => (d.keywords?.length ?? 0) === 0 || d.sourceUrl !== undefined, {
    message: "keywords can only be used with monitors (sourceUrl must be set)",
  })
  .refine((d) => d.scheduleType === "hourly" || d.hour !== undefined, {
    message: "hour is required for daily/weekly/monthly schedules",
  })
  .refine((d) => d.scheduleType !== "weekly" || d.dayOfWeek !== undefined, {
    message: "dayOfWeek is required for weekly schedules",
  })
  .refine((d) => d.scheduleType !== "monthly" || d.dayOfMonth !== undefined, {
    message: "dayOfMonth is required for monthly schedules",
  });

type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

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
        keywords:
          (validated.keywords?.length ?? 0) > 0
            ? JSON.stringify(validated.keywords)
            : undefined,
        useBrowser: validated.useBrowser ?? false,
        description: validated.description,
        nextRunAt: nextRunAt.toISOString(),
      })
      .returning();

    return row;
  }

  async list(chatId: number) {
    // Sort by createdAt then id so the position numbers we hand to the
    // model are stable across calls — the user refers to schedules by their
    // displayed position when asking to delete.
    return this.db
      .select()
      .from(schedules)
      .where(and(eq(schedules.chatId, chatId), eq(schedules.active, true)))
      .orderBy(schedules.createdAt, schedules.id);
  }

  async countActive(chatId: number): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schedules)
      .where(and(eq(schedules.chatId, chatId), eq(schedules.active, true)));
    if (result === undefined) {
      throw new Error("count(*) query returned no rows");
    }
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
      // Also guard on nextRunAt: if a concurrent worker completed this row
      // between SELECT and UPDATE (advancing nextRunAt and clearing claimedAt
      // back to NULL), the lockGuard alone would let us reclaim a row that's
      // no longer due, causing duplicate execution.
      const result = await this.db
        .update(schedules)
        .set({ claimedAt: nowIso })
        .where(
          and(
            eq(schedules.id, row.id),
            eq(schedules.nextRunAt, row.nextRunAt),
            lockGuard
          )
        );
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
          // Compute next from row.nextRunAt (the slot we just attempted),
          // not from `now`, so a long-running batch never silently jumps
          // past intermediate occurrences for short-interval schedules.
          nextRunAt: this.nextOccurrence(row).toISOString(),
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

  async markSuccess(row: ClaimedSchedule) {
    const result = await this.db
      .update(schedules)
      .set({
        nextRunAt: this.nextOccurrence(row).toISOString(),
        retryCount: 0,
        claimedAt: null,
      })
      .where(
        and(eq(schedules.id, row.id), eq(schedules.claimedAt, row.claimedAt))
      );
    return { lockLost: result.meta.changes === 0 };
  }

  /**
   * Compute the next occurrence relative to row.nextRunAt (the slot just
   * processed), not relative to wall-clock `now`. This guarantees we always
   * advance to the next strictly-later occurrence, so a long-running batch
   * for a short-interval schedule (e.g. hourly) never skips intermediate
   * occurrences.
   */
  private nextOccurrence(row: ClaimedSchedule): Date {
    return computeNextRun(
      row.scheduleType,
      row.timezone,
      new Date(row.nextRunAt),
      {
        hour: row.hour ?? undefined,
        minute: row.minute ?? undefined,
        dayOfWeek: row.dayOfWeek ?? undefined,
        dayOfMonth: row.dayOfMonth ?? undefined,
      }
    );
  }

  /**
   * Lock-guarded state write. The UPDATE only succeeds if the caller still
   * owns the lock (claimed_at matches the value they were given at claim
   * time). Without this, a long-running worker that lost ownership to a
   * stale-lock reclaim could overwrite a newer worker's state. Returns
   * `{ lockLost: true }` so the caller can react instead of silently
   * accepting a no-op.
   */
  async updateState(row: ClaimedSchedule, stateJson: string) {
    const STATE_MAX_BYTES = 100 * 1024;
    if (new TextEncoder().encode(stateJson).byteLength > STATE_MAX_BYTES) {
      throw new Error("stateJson exceeds 100KB limit");
    }
    const result = await this.db
      .update(schedules)
      .set({ stateJson })
      .where(
        and(eq(schedules.id, row.id), eq(schedules.claimedAt, row.claimedAt))
      );
    return { lockLost: result.meta.changes === 0 };
  }
}

export {
  createScheduleSchema,
  MAX_ACTIVE_SCHEDULES,
  MAX_RETRIES,
  ScheduleService,
};
export type { CreateScheduleInput };
