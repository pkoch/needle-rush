CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`option_id` text NOT NULL,
	`correct` integer NOT NULL,
	`accepted_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_attempt_per_round` ON `attempts` (`round_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `display_pairs` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`status` text NOT NULL,
	`lease_until` integer,
	`progress` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_room_name` ON `players` (`room_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`owner_id` text NOT NULL,
	`phase` text DEFAULT 'LOBBY' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`scored_rounds` integer DEFAULT 0 NOT NULL,
	`current_round_id` text,
	`deadline` integer,
	`last_activity` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text NOT NULL,
	`options_json` text NOT NULL,
	`correct_option_id` text NOT NULL,
	`clip_key` text NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	`winner_id` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`role` text NOT NULL,
	`player_id` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
