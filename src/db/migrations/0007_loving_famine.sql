CREATE TABLE "attendance_punches" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"attendance_date" date NOT NULL,
	"direction" text NOT NULL,
	"source" text DEFAULT 'qr_terminal' NOT NULL,
	"terminal_user_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_scan_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text,
	"payload" text NOT NULL,
	"reason" text NOT NULL,
	"message" text NOT NULL,
	"terminal_user_id" text,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"basic_salary_deduction_policy" jsonb DEFAULT '{"absent":true,"annualLeave":false,"sickLeave":false,"specialLeave":false,"lateArrival":true,"earlyLeaving":true,"notEmployed":true}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "attendance_employee_date_idx";--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "shift_violations" jsonb;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "area_visited" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "is_company_vehicle" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "payment_mode" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "distance_km" numeric(8, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "per_km_rate" numeric(8, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "petrol_amount" numeric(10, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "sale_amount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "recovery_amount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "return_amount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "shop_type" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "slip_numbers" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "shifts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "basic_salary_deduction_policy_override_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "basic_salary_deduction_policy_override" jsonb;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "not_employed_deduction" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order_booker_trips" ADD COLUMN "shop_type" text DEFAULT 'old' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_terminal_user_id_user_id_fk" FOREIGN KEY ("terminal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_scan_attempts" ADD CONSTRAINT "attendance_scan_attempts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_scan_attempts" ADD CONSTRAINT "attendance_scan_attempts_terminal_user_id_user_id_fk" FOREIGN KEY ("terminal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_settings" ADD CONSTRAINT "hr_payroll_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attendance_punches_employee_date" ON "attendance_punches" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_attendance_punches_date" ON "attendance_punches" USING btree ("attendance_date");--> statement-breakpoint
CREATE INDEX "idx_attendance_punches_timestamp" ON "attendance_punches" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_attendance_scan_attempts_employee" ON "attendance_scan_attempts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_scan_attempts_timestamp" ON "attendance_scan_attempts" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "payrolls_month_idx" ON "payrolls" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_payroll_employee_idx" ON "payslips" USING btree ("payroll_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_employee_date_idx" ON "attendance" USING btree ("employee_id","date");--> statement-breakpoint
ALTER TABLE "attendance" DROP COLUMN "check_in_2";--> statement-breakpoint
ALTER TABLE "attendance" DROP COLUMN "check_out_2";