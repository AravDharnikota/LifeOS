CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor` text DEFAULT 'user' NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`summary` text NOT NULL,
	`data` text
);
--> statement-breakpoint
CREATE INDEX `activity_at_idx` ON `activity_log` (`at`);--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`display_text` text,
	`tool_calls` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_messages_thread_idx` ON `agent_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `agent_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `body_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`taken_at` text NOT NULL,
	`path` text NOT NULL,
	`pose` text DEFAULT 'front' NOT NULL,
	`weight_kg` real,
	`note` text,
	`created_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `body_photos_date_idx` ON `body_photos` (`date`);--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`kind` text DEFAULT 'local' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`google_id` text,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `duration_history` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`title` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`list_id` text,
	`estimate_minutes` integer,
	`actual_minutes` integer NOT NULL,
	`completed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `duration_history_completed_idx` ON `duration_history` (`completed_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text,
	`title` text NOT NULL,
	`notes` text,
	`location` text,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`timezone` text,
	`color` text,
	`kind` text DEFAULT 'event' NOT NULL,
	`task_id` text,
	`locked` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`rrule` text,
	`recurrence_parent_id` text,
	`original_start` text,
	`source` text DEFAULT 'app' NOT NULL,
	`google_id` text,
	`google_etag` text,
	`google_calendar_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `events` (`start`);--> statement-breakpoint
CREATE INDEX `events_task_idx` ON `events` (`task_id`);--> statement-breakpoint
CREATE INDEX `events_cal_idx` ON `events` (`calendar_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'barbell' NOT NULL,
	`body_part` text DEFAULT 'other' NOT NULL,
	`instructions` text,
	`is_custom` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`source` text DEFAULT 'bundled' NOT NULL,
	`barcode` text,
	`per100` text NOT NULL,
	`servings` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `foods_name_idx` ON `foods` (`name`);--> statement-breakpoint
CREATE INDEX `foods_barcode_idx` ON `foods` (`barcode`);--> statement-breakpoint
CREATE TABLE `goal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real DEFAULT 1 NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `goal_entries_goal_idx` ON `goal_entries` (`goal_id`,`date`);--> statement-breakpoint
CREATE TABLE `goal_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`done_at` text,
	`due_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`area` text DEFAULT 'life' NOT NULL,
	`kind` text DEFAULT 'number' NOT NULL,
	`unit` text,
	`start_value` real,
	`target_value` real,
	`current_value` real,
	`direction` text DEFAULT 'increase' NOT NULL,
	`cadence` text,
	`times_per_period` integer,
	`deadline` text,
	`color` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `layout_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`layout_id` text NOT NULL,
	`version` integer NOT NULL,
	`spec` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`spec` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`food_id` text,
	`name` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'serving' NOT NULL,
	`grams` real,
	`calories` real DEFAULT 0 NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`carbs_g` real DEFAULT 0 NOT NULL,
	`fat_g` real DEFAULT 0 NOT NULL,
	`fiber_g` real,
	`sugar_g` real,
	`sodium_mg` real,
	`saturated_fat_g` real,
	`cholesterol_mg` real,
	`potassium_mg` real,
	`confidence` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meal_items_meal_idx` ON `meal_items` (`meal_id`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`meal_type` text DEFAULT 'snack' NOT NULL,
	`name` text,
	`logged_at` text NOT NULL,
	`photo_path` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`ai_notes` text,
	`health_score` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `meals_date_idx` ON `meals` (`date`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'agent' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`type` text NOT NULL,
	`value` real NOT NULL,
	`weight` real,
	`reps` integer,
	`workout_id` text,
	`workout_set_id` text,
	`achieved_at` text NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_exercise_type_idx` ON `personal_records` (`exercise_id`,`type`);--> statement-breakpoint
CREATE TABLE `photo_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`compared_to_photo_id` text,
	`summary` text NOT NULL,
	`observations` text DEFAULT '[]' NOT NULL,
	`progress_score` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `body_photos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scheduler_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ran_at` text NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`placed` integer DEFAULT 0 NOT NULL,
	`moved` integer DEFAULT 0 NOT NULL,
	`unplaced` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`remote_id` text NOT NULL,
	`local_id` text,
	`sync_token` text,
	`last_synced_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `task_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`google_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text,
	`parent_id` text,
	`goal_id` text,
	`title` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` text,
	`due_date` text,
	`due_time` text,
	`start_date` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`estimate_minutes` integer,
	`actual_minutes` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`recurrence` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'app' NOT NULL,
	`google_id` text,
	`google_etag` text,
	`google_list_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`list_id`) REFERENCES `task_lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_list_idx` ON `tasks` (`list_id`);--> statement-breakpoint
CREATE TABLE `template_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`superset_group` integer,
	`rest_seconds` integer,
	`notes` text,
	FOREIGN KEY (`template_id`) REFERENCES `workout_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `template_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`template_exercise_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`set_type` text DEFAULT 'normal' NOT NULL,
	`target_weight` real,
	`target_reps` integer,
	`target_seconds` integer,
	`target_distance` real,
	FOREIGN KEY (`template_exercise_id`) REFERENCES `template_exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracker_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tracker_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tracker_id`) REFERENCES `trackers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tracker_entries_idx` ON `tracker_entries` (`tracker_id`,`date`);--> statement-breakpoint
CREATE TABLE `trackers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'counter' NOT NULL,
	`unit` text,
	`step` real DEFAULT 1 NOT NULL,
	`target` real,
	`reset` text DEFAULT 'daily' NOT NULL,
	`color` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `water_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`ml` integer NOT NULL,
	`logged_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `water_date_idx` ON `water_logs` (`date`);--> statement-breakpoint
CREATE TABLE `weight_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`weight_kg` real NOT NULL,
	`body_fat_pct` real,
	`note` text,
	`logged_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `weight_date_idx` ON `weight_logs` (`date`);--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`superset_group` integer,
	`rest_seconds` integer,
	`notes` text,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_exercise_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`set_type` text DEFAULT 'normal' NOT NULL,
	`weight` real,
	`reps` integer,
	`seconds` integer,
	`distance` real,
	`rpe` real,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`prs` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`workout_exercise_id`) REFERENCES `workout_exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workout_sets_we_idx` ON `workout_sets` (`workout_exercise_id`);--> statement-breakpoint
CREATE TABLE `workout_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`folder` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`last_performed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text,
	`name` text NOT NULL,
	`notes` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_seconds` integer,
	`total_volume` real,
	`total_sets` integer,
	`pr_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workouts_started_idx` ON `workouts` (`started_at`);--> statement-breakpoint
CREATE INDEX `workouts_status_idx` ON `workouts` (`status`);