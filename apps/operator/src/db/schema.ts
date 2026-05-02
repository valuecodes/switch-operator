import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

const schedules = sqliteTable(
  "schedules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: int("chat_id").notNull(),
    scheduleType: text("schedule_type", {
      enum: ["hourly", "daily", "weekly", "monthly"],
    }).notNull(),
    hour: int("hour"),
    minute: int("minute").default(0),
    dayOfWeek: int("day_of_week"),
    dayOfMonth: int("day_of_month"),
    timezone: text("timezone").notNull().default("UTC"),
    fixedMessage: text("fixed_message"),
    messagePrompt: text("message_prompt"),
    sourceUrl: text("source_url"),
    keywords: text("keywords"),
    stateJson: text("state_json"),
    description: text("description").notNull(),
    active: int("active", { mode: "boolean" }).notNull().default(true),
    useBrowser: int("use_browser", { mode: "boolean" })
      .notNull()
      .default(false),
    nextRunAt: text("next_run_at").notNull(),
    claimedAt: text("claimed_at"),
    retryCount: int("retry_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_schedules_next_run").on(table.active, table.nextRunAt)]
);

const pendingActions = sqliteTable("pending_actions", {
  chatId: int("chat_id").primaryKey(),
  actionType: text("action_type", {
    enum: ["create_schedule", "delete_schedule"],
  }).notNull(),
  payload: text("payload").notNull(),
  description: text("description").notNull(),
  expiresAt: text("expires_at").notNull(),
  token: text("token"),
});

export { pendingActions, schedules };
