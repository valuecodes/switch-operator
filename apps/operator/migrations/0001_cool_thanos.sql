CREATE TABLE `pending_actions` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`action_type` text NOT NULL,
	`payload` text NOT NULL,
	`description` text NOT NULL,
	`expires_at` text NOT NULL
);
