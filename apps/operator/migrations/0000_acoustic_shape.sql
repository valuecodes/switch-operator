CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`schedule_type` text NOT NULL,
	`hour` integer,
	`minute` integer DEFAULT 0,
	`day_of_week` integer,
	`day_of_month` integer,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`fixed_message` text,
	`message_prompt` text,
	`source_url` text,
	`state_json` text,
	`description` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`next_run_at` text NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_schedules_next_run` ON `schedules` (`active`,`next_run_at`);