CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'generated' NOT NULL,
	`file_key` text NOT NULL,
	`thumb_key` text,
	`width` integer,
	`height` integer,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`seed` integer,
	`nsfw` integer DEFAULT false NOT NULL,
	`favourite` integer DEFAULT false NOT NULL,
	`parent_image_id` text,
	`prompt_summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `images_owner_created_idx` ON `images` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `images_owner_source_created_idx` ON `images` (`owner_id`,`source`,`created_at`);--> statement-breakpoint
CREATE INDEX `images_job_idx` ON `images` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_hash` text NOT NULL,
	`params` text NOT NULL,
	`status` text NOT NULL,
	`progress` real,
	`prompt_id` text,
	`source_image_id` text,
	`error` text,
	`recoveries` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `jobs_owner_created_idx` ON `jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_status_created_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`nsfw_visible` integer DEFAULT false NOT NULL
);
