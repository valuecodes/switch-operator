CREATE TABLE `pending_conversations` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`messages_json` text NOT NULL,
	`pending_tool_call_id` text NOT NULL,
	`options_json` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL
);
