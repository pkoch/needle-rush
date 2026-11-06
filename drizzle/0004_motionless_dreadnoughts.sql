ALTER TABLE `jobs` ADD `lease_hash` text;--> statement-breakpoint
ALTER TABLE `rounds` ADD `clip_sha` text;--> statement-breakpoint
CREATE UNIQUE INDEX `room_question_slot` ON `rounds` (`room_id`,`number`);