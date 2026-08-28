CREATE TABLE "system_activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_label" text,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"ip_address" text,
	"severity" text DEFAULT 'info' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_activity_log" ADD CONSTRAINT "system_activity_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sal_timestamp_idx" ON "system_activity_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "sal_module_idx" ON "system_activity_log" USING btree ("module");--> statement-breakpoint
CREATE INDEX "sal_actor_idx" ON "system_activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "sal_entity_type_idx" ON "system_activity_log" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "sal_module_timestamp_idx" ON "system_activity_log" USING btree ("module","timestamp");--> statement-breakpoint
CREATE INDEX "sal_actor_timestamp_idx" ON "system_activity_log" USING btree ("actor_id","timestamp");--> statement-breakpoint
CREATE INDEX "sal_severity_idx" ON "system_activity_log" USING btree ("severity");