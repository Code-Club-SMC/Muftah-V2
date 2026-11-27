CREATE TABLE "salary_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"payroll_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"wallet_id" text,
	"transaction_id" text,
	"advance_id" text,
	"payment_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reversal_transaction_id" text,
	"reversal_reason" text,
	"reversed_at" timestamp,
	"reversed_by_id" text,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "salary_payments_amount_check" CHECK ("salary_payments"."amount" > 0),
	CONSTRAINT "salary_payments_shape_check" CHECK (("salary_payments"."kind" in ('payment', 'refund') and "salary_payments"."wallet_id" is not null and "salary_payments"."transaction_id" is not null and "salary_payments"."advance_id" is null)
        or ("salary_payments"."kind" = 'recovery' and "salary_payments"."wallet_id" is null and "salary_payments"."transaction_id" is null and "salary_payments"."advance_id" is not null)),
	CONSTRAINT "salary_payments_reversal_check" CHECK (("salary_payments"."status" = 'active' and "salary_payments"."reversed_at" is null)
        or ("salary_payments"."status" = 'reversed' and "salary_payments"."reversed_at" is not null and "salary_payments"."reversed_by_id" is not null and "salary_payments"."reversal_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_payroll_id_payrolls_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."payrolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_advance_id_salary_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."salary_advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_reversal_transaction_id_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_reversed_by_id_user_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salary_payments_payroll_employee_idx" ON "salary_payments" USING btree ("payroll_id","employee_id");