CREATE TABLE "attendance_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"workbook_id" text,
	"outage_window_id" text,
	"uploaded_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"original_filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ready_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"review_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"blocked_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"excluded_rows" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processing_lease_id" text,
	"processing_lease_expires_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_import_batches_byte_size_check" CHECK ("attendance_import_batches"."byte_size" > 0),
	CONSTRAINT "attendance_import_batches_counts_check" CHECK ("attendance_import_batches"."total_rows" >= 0 AND "attendance_import_batches"."ready_rows" >= 0 AND "attendance_import_batches"."duplicate_rows" >= 0 AND "attendance_import_batches"."review_rows" >= 0 AND "attendance_import_batches"."invalid_rows" >= 0 AND "attendance_import_batches"."blocked_rows" >= 0 AND "attendance_import_batches"."imported_rows" >= 0 AND "attendance_import_batches"."excluded_rows" >= 0),
	CONSTRAINT "attendance_import_batches_reviewer_check" CHECK ("attendance_import_batches"."reviewed_by_user_id" IS NULL OR "attendance_import_batches"."reviewed_by_user_id" <> "attendance_import_batches"."uploaded_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"workbook_id" text NOT NULL,
	"worksheet_row_number" integer NOT NULL,
	"record_token" text NOT NULL,
	"raw_employee_code" text,
	"raw_date" text,
	"raw_time" text,
	"raw_direction" text,
	"raw_note" text,
	"normalized_timestamp" timestamp with time zone,
	"attendance_date" date,
	"employee_id" text,
	"content_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"reason_message" text,
	"punch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_import_rows_row_number_check" CHECK ("attendance_import_rows"."worksheet_row_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_offline_workbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"assigned_operator_user_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"row_capacity" integer NOT NULL,
	"signing_version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"replaced_by_workbook_id" text,
	"retired_by_user_id" text,
	"retired_reason" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_offline_workbooks_versions_check" CHECK ("attendance_offline_workbooks"."template_version" > 0 AND "attendance_offline_workbooks"."signing_version" > 0 AND "attendance_offline_workbooks"."row_capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_outage_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"workbook_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"declared_by_user_id" text NOT NULL,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_outage_windows_range_check" CHECK ("attendance_outage_windows"."starts_at" < "attendance_outage_windows"."ends_at"),
	CONSTRAINT "attendance_outage_windows_actor_check" CHECK ("attendance_outage_windows"."confirmed_by_user_id" IS NULL OR "attendance_outage_windows"."confirmed_by_user_id" <> "attendance_outage_windows"."declared_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_punch_correction_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"original_punch_id" text NOT NULL,
	"original_import_row_id" text,
	"action" text NOT NULL,
	"old_values" jsonb NOT NULL,
	"new_values" jsonb,
	"reason" text NOT NULL,
	"changed_by_user_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_terminal_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"terminal_user_id" text NOT NULL,
	"minute_bucket" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_attendance_invalidations" (
	"id" text PRIMARY KEY NOT NULL,
	"payroll_id" text NOT NULL,
	"import_batch_id" text NOT NULL,
	"affected_summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD COLUMN "offline_import_row_id" text;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD COLUMN "offline_import_identity" text;--> statement-breakpoint
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_workbook_id_attendance_offline_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."attendance_offline_workbooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_outage_window_id_attendance_outage_windows_id_fk" FOREIGN KEY ("outage_window_id") REFERENCES "public"."attendance_outage_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_rows" ADD CONSTRAINT "attendance_import_rows_batch_id_attendance_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."attendance_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_rows" ADD CONSTRAINT "attendance_import_rows_workbook_id_attendance_offline_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."attendance_offline_workbooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_rows" ADD CONSTRAINT "attendance_import_rows_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_rows" ADD CONSTRAINT "attendance_import_rows_punch_id_attendance_punches_id_fk" FOREIGN KEY ("punch_id") REFERENCES "public"."attendance_punches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_offline_workbooks" ADD CONSTRAINT "attendance_offline_workbooks_assigned_operator_user_id_user_id_fk" FOREIGN KEY ("assigned_operator_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_offline_workbooks" ADD CONSTRAINT "attendance_offline_workbooks_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_offline_workbooks" ADD CONSTRAINT "attendance_offline_workbooks_replaced_by_workbook_id_attendance_offline_workbooks_id_fk" FOREIGN KEY ("replaced_by_workbook_id") REFERENCES "public"."attendance_offline_workbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_offline_workbooks" ADD CONSTRAINT "attendance_offline_workbooks_retired_by_user_id_user_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_outage_windows" ADD CONSTRAINT "attendance_outage_windows_workbook_id_attendance_offline_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."attendance_offline_workbooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_outage_windows" ADD CONSTRAINT "attendance_outage_windows_declared_by_user_id_user_id_fk" FOREIGN KEY ("declared_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_outage_windows" ADD CONSTRAINT "attendance_outage_windows_confirmed_by_user_id_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punch_correction_audit" ADD CONSTRAINT "attendance_punch_correction_audit_original_import_row_id_attendance_import_rows_id_fk" FOREIGN KEY ("original_import_row_id") REFERENCES "public"."attendance_import_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punch_correction_audit" ADD CONSTRAINT "attendance_punch_correction_audit_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_terminal_heartbeats" ADD CONSTRAINT "attendance_terminal_heartbeats_terminal_user_id_user_id_fk" FOREIGN KEY ("terminal_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_attendance_invalidations" ADD CONSTRAINT "payroll_attendance_invalidations_payroll_id_payrolls_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."payrolls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_attendance_invalidations" ADD CONSTRAINT "payroll_attendance_invalidations_import_batch_id_attendance_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."attendance_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_attendance_invalidations" ADD CONSTRAINT "payroll_attendance_invalidations_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_import_batches_workbook_idx" ON "attendance_import_batches" USING btree ("workbook_id");--> statement-breakpoint
CREATE INDEX "attendance_import_batches_outage_idx" ON "attendance_import_batches" USING btree ("outage_window_id");--> statement-breakpoint
CREATE INDEX "attendance_import_batches_status_idx" ON "attendance_import_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attendance_import_batches_file_hash_idx" ON "attendance_import_batches" USING btree ("file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_import_rows_batch_row_idx" ON "attendance_import_rows" USING btree ("batch_id","worksheet_row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_import_rows_imported_identity_idx" ON "attendance_import_rows" USING btree ("workbook_id","record_token") WHERE "attendance_import_rows"."status" = 'imported';--> statement-breakpoint
CREATE INDEX "attendance_import_rows_batch_status_idx" ON "attendance_import_rows" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "attendance_import_rows_employee_date_idx" ON "attendance_import_rows" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_offline_workbooks_active_operator_idx" ON "attendance_offline_workbooks" USING btree ("assigned_operator_user_id") WHERE "attendance_offline_workbooks"."status" = 'active';--> statement-breakpoint
CREATE INDEX "attendance_offline_workbooks_status_idx" ON "attendance_offline_workbooks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attendance_outage_windows_workbook_status_idx" ON "attendance_outage_windows" USING btree ("workbook_id","status");--> statement-breakpoint
CREATE INDEX "attendance_punch_correction_audit_punch_idx" ON "attendance_punch_correction_audit" USING btree ("original_punch_id");--> statement-breakpoint
CREATE INDEX "attendance_punch_correction_audit_import_row_idx" ON "attendance_punch_correction_audit" USING btree ("original_import_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_terminal_heartbeats_terminal_minute_idx" ON "attendance_terminal_heartbeats" USING btree ("terminal_user_id","minute_bucket");--> statement-breakpoint
CREATE INDEX "attendance_terminal_heartbeats_observed_idx" ON "attendance_terminal_heartbeats" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_attendance_invalidations_unresolved_idx" ON "payroll_attendance_invalidations" USING btree ("payroll_id","import_batch_id") WHERE "payroll_attendance_invalidations"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "payroll_attendance_invalidations_batch_idx" ON "payroll_attendance_invalidations" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_punches_offline_identity_idx" ON "attendance_punches" USING btree ("offline_import_identity") WHERE "attendance_punches"."offline_import_identity" IS NOT NULL;