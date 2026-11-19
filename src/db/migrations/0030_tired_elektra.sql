CREATE TABLE "compensatory_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"change_hours" numeric(6, 2) NOT NULL,
	"balance_after" numeric(6, 2) NOT NULL,
	"reason" text NOT NULL,
	"attendance_id" text,
	"attendance_date" date,
	"cash_out_id" text,
	"note" text,
	"actor_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compensatory_ledger" ADD CONSTRAINT "compensatory_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensatory_ledger" ADD CONSTRAINT "compensatory_ledger_attendance_id_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensatory_ledger" ADD CONSTRAINT "compensatory_ledger_cash_out_id_compensatory_cash_outs_id_fk" FOREIGN KEY ("cash_out_id") REFERENCES "public"."compensatory_cash_outs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensatory_ledger" ADD CONSTRAINT "compensatory_ledger_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_comp_ledger_employee_created" ON "compensatory_ledger" USING btree ("employee_id","created_at");