import { eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { pendingActions } from "../db/schema";

type PendingActionType = "create_schedule" | "delete_schedule";

type PendingAction = {
  type: PendingActionType;
  payload: Record<string, unknown>;
  description: string;
};

const TTL_MS = 2 * 60 * 1000;

class PendingActionService {
  private readonly db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async set(chatId: number, action: PendingAction): Promise<void> {
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    await this.db
      .insert(pendingActions)
      .values({
        chatId,
        actionType: action.type,
        payload: JSON.stringify(action.payload),
        description: action.description,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: pendingActions.chatId,
        set: {
          actionType: action.type,
          payload: JSON.stringify(action.payload),
          description: action.description,
          expiresAt,
        },
      });
  }

  async get(chatId: number): Promise<PendingAction | undefined> {
    const rows = await this.db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.chatId, chatId))
      .limit(1);

    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];

    // Check expiry
    if (new Date(row.expiresAt) <= new Date()) {
      await this.clear(chatId);
      return undefined;
    }

    return {
      type: row.actionType,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      description: row.description,
    };
  }

  async clear(chatId: number): Promise<void> {
    await this.db
      .delete(pendingActions)
      .where(eq(pendingActions.chatId, chatId));
  }

  async clearExpired(): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .delete(pendingActions)
      .where(lte(pendingActions.expiresAt, now));
  }
}

export { PendingActionService, TTL_MS };
export type { PendingAction, PendingActionType };
