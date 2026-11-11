CREATE TABLE "credit_note_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_counters_last_number_check" CHECK ("credit_note_counters"."last_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_credit_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_return_id" text,
	"source_invoice_id" text NOT NULL,
	"source_payment_id" text,
	"credit_note_number" text,
	"original_amount" numeric(12, 2) NOT NULL,
	"remaining_amount" numeric(12, 2) NOT NULL,
	"applied_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refunded_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reclaimed_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "customer_credit_lots_amounts_check" CHECK ("customer_credit_lots"."original_amount" > 0 and "customer_credit_lots"."remaining_amount" >= 0 and "customer_credit_lots"."applied_amount" >= 0 and "customer_credit_lots"."refunded_amount" >= 0 and "customer_credit_lots"."reclaimed_amount" >= 0),
	CONSTRAINT "customer_credit_lots_conservation_check" CHECK ("customer_credit_lots"."voided_at" is not null or ("customer_credit_lots"."remaining_amount" + "customer_credit_lots"."applied_amount" + "customer_credit_lots"."refunded_amount" + "customer_credit_lots"."reclaimed_amount" = "customer_credit_lots"."original_amount")),
	CONSTRAINT "customer_credit_lots_source_type_check" CHECK ("customer_credit_lots"."source_type" in ('sales_return', 'payment_overage'))
);
--> statement-breakpoint
CREATE TABLE "customer_credit_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"credit_lot_id" text,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"signed_delta" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"sales_return_id" text,
	"credit_note_number" text,
	"invoice_id" text,
	"payment_id" text,
	"refund_id" text,
	"wallet_id" text,
	"notes" text,
	"performed_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_credit_movements_amount_check" CHECK ("customer_credit_movements"."amount" > 0),
	CONSTRAINT "customer_credit_movements_balance_after_check" CHECK ("customer_credit_movements"."balance_after" >= 0),
	CONSTRAINT "customer_credit_movements_type_check" CHECK ("customer_credit_movements"."type" in ('issued', 'applied', 'application_reversed', 'refunded', 'refund_reversed', 'void_reclaimed', 'void_unapplied'))
);
--> statement-breakpoint
CREATE TABLE "customer_credit_payment_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"credit_lot_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "credit_payment_alloc_amount_check" CHECK ("customer_credit_payment_allocations"."amount" > 0),
	CONSTRAINT "credit_payment_alloc_status_check" CHECK ("customer_credit_payment_allocations"."status" in ('active', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE "customer_refund_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"refund_id" text NOT NULL,
	"credit_lot_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "customer_refund_alloc_amount_check" CHECK ("customer_refund_allocations"."amount" > 0),
	CONSTRAINT "customer_refund_alloc_status_check" CHECK ("customer_refund_allocations"."status" in ('active', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE "customer_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"sales_return_id" text,
	"credit_note_number" text,
	"wallet_id" text NOT NULL,
	"wallet_transaction_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"refund_date" timestamp with time zone NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_id" text,
	"reversed_at" timestamp with time zone,
	"reverse_reason" text,
	"reversal_transaction_id" text,
	CONSTRAINT "customer_refunds_amount_check" CHECK ("customer_refunds"."amount" > 0),
	CONSTRAINT "customer_refunds_status_check" CHECK ((
        ("customer_refunds"."status" = 'active' and "customer_refunds"."reversed_by_id" is null and "customer_refunds"."reversed_at" is null and "customer_refunds"."reverse_reason" is null and "customer_refunds"."reversal_transaction_id" is null) or
        ("customer_refunds"."status" = 'reversed' and "customer_refunds"."reversed_by_id" is not null and "customer_refunds"."reversed_at" is not null and nullif(btrim("customer_refunds"."reverse_reason"), '') is not null and "customer_refunds"."reversal_transaction_id" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_status_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_details_check";--> statement-breakpoint
ALTER TABLE "slip_records" DROP CONSTRAINT "slip_records_settlement_amounts_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_settlement_amounts_check";--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "credit_note_number" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "credit_note_issued_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "applied_to_invoice_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "customer_credit_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "slip_records" ADD COLUMN "excess_credited_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_balance" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "excess_credited_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_credit_lots" ADD CONSTRAINT "customer_credit_lots_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_lots" ADD CONSTRAINT "customer_credit_lots_source_return_id_sales_returns_id_fk" FOREIGN KEY ("source_return_id") REFERENCES "public"."sales_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_lots" ADD CONSTRAINT "customer_credit_lots_source_invoice_id_invoices_id_fk" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_lots" ADD CONSTRAINT "customer_credit_lots_source_payment_id_payments_id_fk" FOREIGN KEY ("source_payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_credit_lot_id_customer_credit_lots_id_fk" FOREIGN KEY ("credit_lot_id") REFERENCES "public"."customer_credit_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_sales_return_id_sales_returns_id_fk" FOREIGN KEY ("sales_return_id") REFERENCES "public"."sales_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_refund_id_customer_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."customer_refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_performed_by_id_user_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_payment_allocations" ADD CONSTRAINT "customer_credit_payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_payment_allocations" ADD CONSTRAINT "customer_credit_payment_allocations_credit_lot_id_customer_credit_lots_id_fk" FOREIGN KEY ("credit_lot_id") REFERENCES "public"."customer_credit_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refund_allocations" ADD CONSTRAINT "customer_refund_allocations_refund_id_customer_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."customer_refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refund_allocations" ADD CONSTRAINT "customer_refund_allocations_credit_lot_id_customer_credit_lots_id_fk" FOREIGN KEY ("credit_lot_id") REFERENCES "public"."customer_credit_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refunds" ADD CONSTRAINT "customer_refunds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refunds" ADD CONSTRAINT "customer_refunds_sales_return_id_sales_returns_id_fk" FOREIGN KEY ("sales_return_id") REFERENCES "public"."sales_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refunds" ADD CONSTRAINT "customer_refunds_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refunds" ADD CONSTRAINT "customer_refunds_wallet_transaction_id_transactions_id_fk" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refunds" ADD CONSTRAINT "customer_refunds_issued_by_id_user_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refunds" ADD CONSTRAINT "customer_refunds_reversed_by_id_user_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_refunds" ADD CONSTRAINT "customer_refunds_reversal_transaction_id_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_credit_lots_customer_created" ON "customer_credit_lots" USING btree ("customer_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_customer_credit_lots_source_return" ON "customer_credit_lots" USING btree ("source_return_id");--> statement-breakpoint
CREATE INDEX "idx_customer_credit_lots_source_invoice" ON "customer_credit_lots" USING btree ("source_invoice_id");--> statement-breakpoint
CREATE INDEX "idx_customer_credit_movements_customer" ON "customer_credit_movements" USING btree ("customer_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_credit_payment_alloc_payment" ON "customer_credit_payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_credit_payment_alloc_lot" ON "customer_credit_payment_allocations" USING btree ("credit_lot_id");--> statement-breakpoint
CREATE INDEX "idx_customer_refund_alloc_refund" ON "customer_refund_allocations" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "idx_customer_refund_alloc_lot" ON "customer_refund_allocations" USING btree ("credit_lot_id");--> statement-breakpoint
CREATE INDEX "idx_customer_refunds_customer_date" ON "customer_refunds" USING btree ("customer_id","refund_date");--> statement-breakpoint
CREATE INDEX "idx_customer_refunds_return" ON "customer_refunds" USING btree ("sales_return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_returns_credit_note_number" ON "sales_returns" USING btree ("credit_note_number") WHERE "sales_returns"."credit_note_number" is not null;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_status_check" CHECK ((
        ("payments"."method" in ('cash', 'expense_offset', 'customer_credit') and "payments"."status" in ('confirmed', 'reversed')) or
        ("payments"."method" = 'bank_transfer' and "payments"."status" in ('pending', 'confirmed', 'cancelled', 'reversed')) or
        ("payments"."method" = 'cheque' and "payments"."status" in ('pending', 'confirmed', 'returned', 'cancelled', 'reversed'))
      ));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_details_check" CHECK ((
        ("payments"."method" in ('expense_offset', 'customer_credit') or "payments"."wallet_id" is not null) and
        ("payments"."method" <> 'bank_transfer' or nullif(btrim("payments"."reference"), '') is not null) and
        ("payments"."method" <> 'cheque' or (
          nullif(btrim("payments"."cheque_number"), '') is not null and
          nullif(btrim("payments"."cheque_bank"), '') is not null and
          "payments"."cheque_date" is not null
        ))
      ));--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_credit_split_nonnegative_check" CHECK ("sales_returns"."applied_to_invoice_amount" >= 0 and "sales_returns"."customer_credit_amount" >= 0);--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_completion_credit_note_check" CHECK ("sales_returns"."status" not in ('completed', 'voided') or (nullif(btrim("sales_returns"."credit_note_number"), '') is not null and "sales_returns"."applied_to_invoice_amount" + "sales_returns"."customer_credit_amount" = "sales_returns"."total_amount"));--> statement-breakpoint
ALTER TABLE "slip_records" ADD CONSTRAINT "slip_records_settlement_amounts_check" CHECK ("slip_records"."invoice_amount" >= 0 and "slip_records"."paid_amount" >= 0 and "slip_records"."returned_amount" >= 0 and "slip_records"."excess_credited_amount" >= 0 and "slip_records"."outstanding_amount" >= 0 and "slip_records"."paid_amount" + "slip_records"."returned_amount" - "slip_records"."excess_credited_amount" + "slip_records"."outstanding_amount" = "slip_records"."invoice_amount");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_credit_balance_nonnegative_check" CHECK ("customers"."credit_balance" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_excess_credited_amount_nonnegative_check" CHECK ("invoices"."excess_credited_amount" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_settlement_amounts_check" CHECK ("invoices"."paid_amount" >= 0 and "invoices"."returned_amount" >= 0 and "invoices"."excess_credited_amount" >= 0 and "invoices"."outstanding_amount" >= 0 and "invoices"."paid_amount" + "invoices"."returned_amount" - "invoices"."excess_credited_amount" + "invoices"."outstanding_amount" = "invoices"."total_price");