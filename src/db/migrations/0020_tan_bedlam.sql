CREATE TABLE "attendance_time_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"attendance_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"shift_index" integer NOT NULL,
	"kind" text NOT NULL,
	"minutes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_by" text,
	"decided_at" timestamp,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_time_exceptions" ADD CONSTRAINT "attendance_time_exceptions_attendance_id_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_time_exceptions" ADD CONSTRAINT "attendance_time_exceptions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_time_exceptions" ADD CONSTRAINT "attendance_time_exceptions_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_time_exceptions_item_idx" ON "attendance_time_exceptions" USING btree ("attendance_id","shift_index","kind");--> statement-breakpoint
CREATE INDEX "attendance_time_exceptions_status_date_idx" ON "attendance_time_exceptions" USING btree ("status","date");--> statement-breakpoint
CREATE INDEX "attendance_time_exceptions_employee_date_idx" ON "attendance_time_exceptions" USING btree ("employee_id","date");