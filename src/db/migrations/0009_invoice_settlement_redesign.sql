CREATE TABLE "invoice_number_counters" (
	"kind" text PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_number_counters_next_value_check" CHECK ("invoice_number_counters"."next_value" > 0),
	CONSTRAINT "invoice_number_counters_kind_check" CHECK ("invoice_number_counters"."kind" in ('online', 'offline'))
);
--> statement-breakpoint

-- Keep existing business values while replacing unclear names.
ALTER TABLE "customers" RENAME COLUMN "payment" TO "total_paid_amount";
--> statement-breakpoint
ALTER TABLE "customers" RENAME COLUMN "credit" TO "outstanding_amount";
--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "slip_number" TO "invoice_number";
--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "cash" TO "paid_amount";
--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "credit" TO "outstanding_amount";
--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "credit_return_date" TO "payment_due_date";
--> statement-breakpoint
ALTER TABLE "slip_records" RENAME COLUMN "amount_recovered" TO "paid_amount";
--> statement-breakpoint
ALTER TABLE "slip_records" RENAME COLUMN "amount_due" TO "outstanding_amount";
--> statement-breakpoint

-- Existing timestamps were written as factory-local time. Preserve that instant.
ALTER TABLE "invoices" ALTER COLUMN "payment_due_date" SET DATA TYPE timestamp with time zone
	USING "payment_due_date" AT TIME ZONE 'Asia/Karachi';
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "payment_date" SET DATA TYPE timestamp with time zone
	USING "payment_date" AT TIME ZONE 'Asia/Karachi';
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "payment_date" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "method" DROP DEFAULT;
--> statement-breakpoint

-- Add lifecycle columns as nullable first. They become required only after backfill.
ALTER TABLE "invoices" ADD COLUMN "source" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_status" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "status" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "wallet_id" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cheque_number" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cheque_bank" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cheque_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "effective_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "source" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "source_record_id" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "allocation_group_id" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "confirmed_by_id" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "resolved_by_id" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "resolution_reason" text;
--> statement-breakpoint
ALTER TABLE "slip_records" ADD COLUMN "invoice_amount" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "effective_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reversal_of_transaction_id" text;
--> statement-breakpoint

-- Public sequences are independent. Internal s_no remains private.
INSERT INTO "invoice_number_counters" ("kind", "next_value")
VALUES
	('online', (SELECT COALESCE(MAX("s_no"), 0) + 1 FROM "invoices")),
	('offline', 1);
--> statement-breakpoint

UPDATE "customers"
SET
	"total_paid_amount" = COALESCE("total_paid_amount", 0),
	"outstanding_amount" = COALESCE("outstanding_amount", 0);
--> statement-breakpoint

UPDATE "invoices"
SET
	"invoice_number" = COALESCE(NULLIF(BTRIM("invoice_number"), ''), 'INV-' || "s_no"::text),
	"paid_amount" = LEAST(GREATEST(COALESCE("paid_amount", 0), 0), GREATEST("total_price", 0)),
	"outstanding_amount" = GREATEST("total_price" - LEAST(GREATEST(COALESCE("paid_amount", 0), 0), GREATEST("total_price", 0)), 0),
	"source" = 'online',
	"status" = CASE WHEN "status" = 'voided' THEN 'voided' ELSE 'saved' END;
--> statement-breakpoint

-- Legacy invoice_cash is ordinary confirmed cash. Existing recovery rows were
-- already treated as received by the old system, so all legacy rows are confirmed.
UPDATE "payments"
SET
	"method" = CASE WHEN "method" = 'invoice_cash' THEN 'cash' ELSE "method" END,
	"status" = 'confirmed',
	"source" = CASE
		WHEN "notes" = 'Initial payment on invoice creation' THEN 'invoice_creation'
		WHEN "method" = 'expense_offset' THEN 'adjustment'
		ELSE 'recovery'
	END,
	"source_record_id" = 'legacy:' || "id",
	"effective_date" = "payment_date",
	"confirmed_by_id" = "recorded_by_id",
	"confirmed_at" = "created_at" AT TIME ZONE 'Asia/Karachi';
--> statement-breakpoint

-- Recover wallet identity from the journal first, then the old invoice account.
UPDATE "payments" AS p
SET "wallet_id" = COALESCE(
	(
		SELECT t."wallet_id"
		FROM "transactions" AS t
		WHERE t."reference_id" = p."id" AND t."type" = 'credit'
		ORDER BY t."created_at", t."id"
		LIMIT 1
	),
	(
		SELECT t."wallet_id"
		FROM "transactions" AS t
		WHERE t."reference_id" = p."invoice_id" AND t."source" = 'Sale' AND t."type" = 'credit'
		ORDER BY t."created_at", t."id"
		LIMIT 1
	),
	(
		SELECT i."account"
		FROM "invoices" AS i
		INNER JOIN "wallets" AS w ON w."id" = i."account"
		WHERE i."id" = p."invoice_id"
	)
)
WHERE p."method" IN ('cash', 'bank_transfer');
--> statement-breakpoint

-- Payment rows become aggregate truth before slip caches are rebuilt.
UPDATE "invoices" AS i
SET
	"paid_amount" = LEAST(
		GREATEST(COALESCE((
			SELECT SUM(p."amount")
			FROM "payments" AS p
			WHERE p."invoice_id" = i."id" AND p."status" = 'confirmed'
		), i."paid_amount", 0), 0),
		GREATEST(i."total_price", 0)
	),
	"outstanding_amount" = GREATEST(
		i."total_price" - LEAST(
			GREATEST(COALESCE((
				SELECT SUM(p."amount")
				FROM "payments" AS p
				WHERE p."invoice_id" = i."id" AND p."status" = 'confirmed'
			), i."paid_amount", 0), 0),
			GREATEST(i."total_price", 0)
		),
		0
	);
--> statement-breakpoint

UPDATE "invoices"
SET "payment_status" = CASE
	WHEN "paid_amount" = 0 THEN 'unpaid'
	WHEN "outstanding_amount" = 0 THEN 'paid'
	ELSE 'partially_paid'
END;
--> statement-breakpoint

UPDATE "slip_records" AS s
SET
	"invoice_amount" = i."total_price",
	"paid_amount" = i."paid_amount",
	"outstanding_amount" = i."outstanding_amount",
	"status" = CASE
		WHEN i."outstanding_amount" = 0 THEN 'closed'
		WHEN i."paid_amount" > 0 THEN 'partially_recovered'
		ELSE 'open'
	END
FROM "invoices" AS i
WHERE i."id" = s."invoice_id";
--> statement-breakpoint

UPDATE "transactions"
SET "effective_date" = "created_at" AT TIME ZONE 'Asia/Karachi';
--> statement-breakpoint

-- Stop rather than silently invent accounting data if legacy rows are invalid.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "invoices" WHERE "total_price" < 0) THEN
		RAISE EXCEPTION 'Invoice settlement migration found a negative invoice total';
	END IF;
	IF EXISTS (
		SELECT "invoice_number" FROM "invoices" GROUP BY "invoice_number" HAVING COUNT(*) > 1
	) THEN
		RAISE EXCEPTION 'Invoice settlement migration found duplicate public invoice numbers';
	END IF;
	IF EXISTS (
		SELECT "order_id" FROM "invoices" WHERE "order_id" IS NOT NULL GROUP BY "order_id" HAVING COUNT(*) > 1
	) THEN
		RAISE EXCEPTION 'Invoice settlement migration found an order linked to multiple invoices';
	END IF;
	IF EXISTS (
		SELECT "invoice_id" FROM "slip_records" GROUP BY "invoice_id" HAVING COUNT(*) > 1
	) THEN
		RAISE EXCEPTION 'Invoice settlement migration found multiple slips for one invoice';
	END IF;
	IF EXISTS (SELECT 1 FROM "payments" WHERE "amount" <= 0) THEN
		RAISE EXCEPTION 'Invoice settlement migration found a non-positive payment';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "payments"
		WHERE "method" IN ('cash', 'bank_transfer') AND "wallet_id" IS NULL
	) THEN
		RAISE EXCEPTION 'Invoice settlement migration could not identify a wallet for a legacy payment';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "payments"
		WHERE "method" = 'bank_transfer' AND NULLIF(BTRIM("reference"), '') IS NULL
	) THEN
		RAISE EXCEPTION 'Invoice settlement migration found a bank transfer without a reference';
	END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "customers" ALTER COLUMN "total_paid_amount" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "total_paid_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "outstanding_amount" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "outstanding_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "invoice_number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "paid_amount" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "paid_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "outstanding_amount" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "outstanding_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "source" SET DEFAULT 'online';
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "payment_status" SET DEFAULT 'unpaid';
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "payment_status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "slip_records" ALTER COLUMN "invoice_amount" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "slip_records" ALTER COLUMN "invoice_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "effective_date" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "effective_date" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reversal_of_transaction_id_transactions_id_fk" FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_id_user_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "transactions_effective_date_idx" ON "transactions" USING btree ("effective_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_reversal_unique" ON "transactions" USING btree ("reversal_of_transaction_id") WHERE "transactions"."reversal_of_transaction_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_source_record_unique" ON "payments" USING btree ("source", "source_record_id") WHERE "payments"."source_record_id" is not null;
--> statement-breakpoint
CREATE INDEX "payments_invoice_status_idx" ON "payments" USING btree ("invoice_id", "status");
--> statement-breakpoint
CREATE INDEX "payments_effective_date_idx" ON "payments" USING btree ("effective_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "slip_records_invoice_unique" ON "slip_records" USING btree ("invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_number_unique" ON "invoices" USING btree ("invoice_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_order_id_unique" ON "invoices" USING btree ("order_id") WHERE "invoices"."order_id" is not null;
--> statement-breakpoint

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive_check" CHECK ("payments"."amount" > 0);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_status_check" CHECK ((
	("payments"."method" in ('cash', 'expense_offset') and "payments"."status" in ('confirmed', 'reversed')) or
	("payments"."method" = 'bank_transfer' and "payments"."status" in ('pending', 'confirmed', 'cancelled', 'reversed')) or
	("payments"."method" = 'cheque' and "payments"."status" in ('pending', 'confirmed', 'returned', 'cancelled', 'reversed'))
));
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_details_check" CHECK ((
	("payments"."method" = 'expense_offset' or "payments"."wallet_id" is not null) and
	("payments"."method" <> 'bank_transfer' or nullif(btrim("payments"."reference"), '') is not null) and
	("payments"."method" <> 'cheque' or (
		nullif(btrim("payments"."cheque_number"), '') is not null and
		nullif(btrim("payments"."cheque_bank"), '') is not null and
		"payments"."cheque_date" is not null
	))
));
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmation_check" CHECK ((
	("payments"."status" in ('confirmed', 'reversed') and "payments"."effective_date" is not null and "payments"."confirmed_by_id" is not null and "payments"."confirmed_at" is not null) or
	("payments"."status" in ('pending', 'returned', 'cancelled') and "payments"."effective_date" is null and "payments"."confirmed_by_id" is null and "payments"."confirmed_at" is null)
));
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_resolution_check" CHECK ((
	("payments"."status" in ('returned', 'cancelled', 'reversed') and "payments"."resolved_by_id" is not null and "payments"."resolved_at" is not null and nullif(btrim("payments"."resolution_reason"), '') is not null) or
	("payments"."status" in ('pending', 'confirmed') and "payments"."resolved_by_id" is null and "payments"."resolved_at" is null and "payments"."resolution_reason" is null)
));
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_source_check" CHECK ("payments"."source" in ('invoice_creation', 'recovery', 'offline_import', 'adjustment'));
--> statement-breakpoint
ALTER TABLE "slip_records" ADD CONSTRAINT "slip_records_settlement_amounts_check" CHECK ("slip_records"."invoice_amount" >= 0 and "slip_records"."paid_amount" >= 0 and "slip_records"."outstanding_amount" >= 0 and "slip_records"."paid_amount" + "slip_records"."outstanding_amount" = "slip_records"."invoice_amount");
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_settlement_amounts_check" CHECK ("invoices"."paid_amount" >= 0 and "invoices"."outstanding_amount" >= 0 and "invoices"."paid_amount" + "invoices"."outstanding_amount" = "invoices"."total_price");
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_check" CHECK ("invoices"."source" in ('online', 'offline_import'));
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_status_check" CHECK ("invoices"."payment_status" in ('unpaid', 'partially_paid', 'paid'));
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lifecycle_status_check" CHECK ("invoices"."status" in ('saved', 'voided'));
--> statement-breakpoint

-- Old account has served its only migration purpose. Payment rows now own wallets.
ALTER TABLE "invoices" DROP COLUMN "account";
