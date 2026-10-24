CREATE TABLE "compensatory_cash_outs" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_date" date NOT NULL,
	"notes" text,
	"paid_in_payslip_id" text,
	"rate_per_hour" numeric(12, 4),
	"amount" numeric(12, 2),
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "comp_cash_out_hours" numeric(6, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "comp_cash_out_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "compensatory_cash_outs" ADD CONSTRAINT "compensatory_cash_outs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensatory_cash_outs" ADD CONSTRAINT "compensatory_cash_outs_paid_in_payslip_id_payslips_id_fk" FOREIGN KEY ("paid_in_payslip_id") REFERENCES "public"."payslips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensatory_cash_outs" ADD CONSTRAINT "compensatory_cash_outs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_comp_cash_outs_employee" ON "compensatory_cash_outs" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_comp_cash_outs_payslip" ON "compensatory_cash_outs" USING btree ("paid_in_payslip_id");