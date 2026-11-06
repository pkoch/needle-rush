CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `rooms` ADD `active_key` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_active_key_unique` ON `rooms` (`active_key`);