CREATE TABLE "production_progress_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"production_run_id" text NOT NULL,
	"units_produced" integer NOT NULL,
	"original_units_produced" integer,
	"created_by_id" text NOT NULL,
	"edited_by_id" text,
	"edit_reason" text,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_materials_used" ADD COLUMN "progress_log_id" text;--> statement-breakpoint
ALTER TABLE "production_progress_logs" ADD CONSTRAINT "production_progress_logs_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_progress_logs" ADD CONSTRAINT "production_progress_logs_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_progress_logs" ADD CONSTRAINT "production_progress_logs_edited_by_id_user_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prod_progress_log_run_created_at_idx" ON "production_progress_logs" USING btree ("production_run_id","created_at");--> statement-breakpoint
ALTER TABLE "production_materials_used" ADD CONSTRAINT "production_materials_used_progress_log_id_production_progress_logs_id_fk" FOREIGN KEY ("progress_log_id") REFERENCES "public"."production_progress_logs"("id") ON DELETE set null ON UPDATE no action;