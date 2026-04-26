import { and, eq, gt, lte } from "drizzle-orm";
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

const generateToken = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const rowToAction = (row: {
  actionType: PendingActionType;
  payload: string;
  description: string;
}): PendingAction => ({
  type: row.actionType,
  payload: JSON.parse(row.payload) as Record<string, unknown>,
  description: row.description,
});

class PendingActionService {
  private readonly db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Stores the action and returns a token that must be embedded in the
   * inline-button callback_data. Old rows for this chat are overwritten,
   * which also invalidates any token bound to the previous row.
   */
  async set(chatId: number, action: PendingAction): Promise<string> {
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const token = generateToken();
    await this.db
      .insert(pendingActions)
      .values({
        chatId,
        actionType: action.type,
        payload: JSON.stringify(action.payload),
        description: action.description,
        expiresAt,
        token,
      })
      .onConflictDoUpdate({
        target: pendingActions.chatId,
        set: {
          actionType: action.type,
          payload: JSON.stringify(action.payload),
          description: action.description,
          expiresAt,
          token,
        },
      });
    return token;
  }

  /**
   * Atomically claims the pending action by token in a single DELETE,
   * preventing double-execution when two callbacks (e.g. a double-tap)
   * race. A stale token simply doesn't match and leaves the current row
   * intact — only expiry clears.
   */
  async consumeByToken(
    chatId: number,
    token: string
  ): Promise<PendingAction | undefined> {
    const nowIso = new Date().toISOString();
    const deleted = await this.db
      .delete(pendingActions)
      .where(
        and(
          eq(pendingActions.chatId, chatId),
          eq(pendingActions.token, token),
          gt(pendingActions.expiresAt, nowIso)
        )
      )
      .returning();
    if (deleted.length === 0) {
      return undefined;
    }
    return rowToAction(deleted[0]);
  }

  /**
   * Atomically claims the pending action for a chat without a token check,
   * used by the typed-YES fallback path. Returns undefined when no
   * non-expired row exists.
   */
  async consumeByChatId(chatId: number): Promise<PendingAction | undefined> {
    const nowIso = new Date().toISOString();
    const deleted = await this.db
      .delete(pendingActions)
      .where(
        and(
          eq(pendingActions.chatId, chatId),
          gt(pendingActions.expiresAt, nowIso)
        )
      )
      .returning();
    if (deleted.length === 0) {
      return undefined;
    }
    return rowToAction(deleted[0]);
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

export { generateToken, PendingActionService, TTL_MS };
export type { PendingAction, PendingActionType };
