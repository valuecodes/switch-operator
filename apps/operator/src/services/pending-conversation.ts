import { and, eq, gt, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { pendingConversations } from "../db/schema";
import { generateToken } from "./pending-action";

type QuestionOptionValue = boolean | string | number;

type QuestionOption = {
  label: string;
  value: QuestionOptionValue;
};

type PendingConversation = {
  messages: unknown[];
  pendingToolCallId: string;
  options: QuestionOption[];
};

const TTL_MS = 5 * 60 * 1000;

type PendingConversationRow = {
  messagesJson: string;
  pendingToolCallId: string;
  optionsJson: string;
};

const parseRow = (
  row: PendingConversationRow
): PendingConversation | undefined => {
  try {
    return {
      messages: JSON.parse(row.messagesJson) as unknown[],
      pendingToolCallId: row.pendingToolCallId,
      options: JSON.parse(row.optionsJson) as QuestionOption[],
    };
  } catch {
    return undefined;
  }
};

class PendingConversationService {
  private readonly db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async set(
    chatId: number,
    conversation: PendingConversation
  ): Promise<string> {
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const token = generateToken();
    const messagesJson = JSON.stringify(conversation.messages);
    const optionsJson = JSON.stringify(conversation.options);
    await this.db
      .insert(pendingConversations)
      .values({
        chatId,
        messagesJson,
        pendingToolCallId: conversation.pendingToolCallId,
        optionsJson,
        token,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: pendingConversations.chatId,
        set: {
          messagesJson,
          pendingToolCallId: conversation.pendingToolCallId,
          optionsJson,
          token,
          expiresAt,
        },
      });
    return token;
  }

  async getByToken(
    chatId: number,
    token: string
  ): Promise<PendingConversation | undefined> {
    const nowIso = new Date().toISOString();
    const rows = await this.db
      .select()
      .from(pendingConversations)
      .where(
        and(
          eq(pendingConversations.chatId, chatId),
          eq(pendingConversations.token, token),
          gt(pendingConversations.expiresAt, nowIso)
        )
      );
    if (rows.length === 0) {
      return undefined;
    }
    return parseRow(rows[0]);
  }

  async consumeByToken(
    chatId: number,
    token: string
  ): Promise<PendingConversation | undefined> {
    const nowIso = new Date().toISOString();
    const deleted = await this.db
      .delete(pendingConversations)
      .where(
        and(
          eq(pendingConversations.chatId, chatId),
          eq(pendingConversations.token, token),
          gt(pendingConversations.expiresAt, nowIso)
        )
      )
      .returning();
    if (deleted.length === 0) {
      return undefined;
    }
    return parseRow(deleted[0]);
  }

  async clear(chatId: number): Promise<void> {
    await this.db
      .delete(pendingConversations)
      .where(eq(pendingConversations.chatId, chatId));
  }

  async clearExpired(): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .delete(pendingConversations)
      .where(lte(pendingConversations.expiresAt, now));
  }
}

export { PendingConversationService, TTL_MS };
export type { PendingConversation, QuestionOption, QuestionOptionValue };
