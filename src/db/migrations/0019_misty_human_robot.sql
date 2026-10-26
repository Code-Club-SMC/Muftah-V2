ALTER TABLE "device_attendance_imports" ADD COLUMN "undone_by_user_id" text;--> statement-breakpoint
ALTER TABLE "device_attendance_imports" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_attendance_imports" ADD CONSTRAINT "device_attendance_imports_undone_by_user_id_user_id_fk" FOREIGN KEY ("undone_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_attendance_imports_sha_idx" ON "device_attendance_imports" USING btree ("file_sha256");