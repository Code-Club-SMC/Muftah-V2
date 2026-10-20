CREATE TABLE "device_attendance_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"report" jsonb NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"result_rows" jsonb,
	"uploaded_by_user_id" text NOT NULL,
	"confirmed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_attendance_person_mappings" (
	"person_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"linked_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_attendance_punch_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"report_date" date NOT NULL,
	"attendance_date" date NOT NULL,
	"direction" text NOT NULL,
	"punch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_attendance_invalidations" ALTER COLUMN "import_batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_attendance_invalidations" ADD COLUMN "device_import_id" text;--> statement-breakpoint
ALTER TABLE "payroll_attendance_invalidations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_attendance_imports" ADD CONSTRAINT "device_attendance_imports_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_attendance_imports" ADD CONSTRAINT "device_attendance_imports_confirmed_by_user_id_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_attendance_person_mappings" ADD CONSTRAINT "device_attendance_person_mappings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_attendance_person_mappings" ADD CONSTRAINT "device_attendance_person_mappings_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_attendance_punch_claims" ADD CONSTRAINT "device_attendance_punch_claims_import_id_device_attendance_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."device_attendance_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_attendance_punch_claims" ADD CONSTRAINT "device_attendance_punch_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_attendance_punch_claims" ADD CONSTRAINT "device_attendance_punch_claims_punch_id_attendance_punches_id_fk" FOREIGN KEY ("punch_id") REFERENCES "public"."attendance_punches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_attendance_imports_created_idx" ON "device_attendance_imports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_attendance_person_employee_idx" ON "device_attendance_person_mappings" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_attendance_punch_identity_idx" ON "device_attendance_punch_claims" USING btree ("employee_id","timestamp");--> statement-breakpoint
CREATE INDEX "device_attendance_claim_date_idx" ON "device_attendance_punch_claims" USING btree ("employee_id","attendance_date");--> statement-breakpoint
ALTER TABLE "payroll_attendance_invalidations" ADD CONSTRAINT "payroll_attendance_invalidations_device_import_id_device_attendance_imports_id_fk" FOREIGN KEY ("device_import_id") REFERENCES "public"."device_attendance_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_attendance_invalidations_device_idx" ON "payroll_attendance_invalidations" USING btree ("payroll_id","device_import_id") WHERE "payroll_attendance_invalidations"."resolved_at" IS NULL;