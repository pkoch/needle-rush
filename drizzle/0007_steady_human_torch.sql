CREATE TABLE `postgame_playback` (
	`room_id` text PRIMARY KEY NOT NULL,
	`track_id` text,
	`started_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `rounds` ADD `artwork_key` text;--> statement-breakpoint
ALTER TABLE `rounds` ADD `artwork_status` text DEFAULT 'PENDING' NOT NULL;