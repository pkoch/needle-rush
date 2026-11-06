ALTER TABLE `rooms` ADD `display_last_seen` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `pause_requested` integer DEFAULT 0 NOT NULL;