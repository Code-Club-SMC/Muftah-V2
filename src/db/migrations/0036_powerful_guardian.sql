CREATE TABLE "supplier_credit_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"supplier_return_id" text,
	"purchase_id" text,
	"supplier_payment_id" text,
	"note" text,
	"performed_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_credit_kind_ck" CHECK ("supplier_credit_movements"."kind" IN ('issued', 'used', 'use_reversed', 'issue_reversed')),
	CONSTRAINT "supplier_credit_sign_ck" CHECK (("supplier_credit_movements"."kind" IN ('issued', 'use_reversed') AND "supplier_credit_movements"."amount" > 0) OR ("supplier_credit_movements"."kind" IN ('used', 'issue_reversed') AND "supplier_credit_movements"."amount" < 0))
);
--> statement-breakpoint
CREATE TABLE "supplier_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"return_number" text NOT NULL,
	"supplier_id" text NOT NULL,
	"purchase_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"material_type" text NOT NULL,
	"chemical_id" text,
	"packaging_material_id" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_by_id" text,
	"dispatched_at" timestamp with time zone,
	"completed_by_id" text,
	"completed_at" timestamp with time zone,
	"debit_note_number" text,
	"applied_to_purchase_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refund_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refund_wallet_id" text,
	"refund_transaction_id" text,
	"supplier_credit_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cancelled_by_id" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"voided_by_id" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_returns_status_ck" CHECK ("supplier_returns"."status" IN ('requested', 'dispatched', 'completed', 'cancelled', 'voided')),
	CONSTRAINT "supplier_returns_quantity_ck" CHECK ("supplier_returns"."quantity" > 0 AND "supplier_returns"."unit_cost" >= 0 AND "supplier_returns"."total_amount" >= 0),
	CONSTRAINT "supplier_returns_debit_note_ck" CHECK ("supplier_returns"."status" NOT IN ('completed', 'voided') OR (
      "supplier_returns"."debit_note_number" IS NOT NULL AND "supplier_returns"."completed_at" IS NOT NULL
      AND "supplier_returns"."applied_to_purchase_amount" + "supplier_returns"."refund_amount" + "supplier_returns"."supplier_credit_amount" = "supplier_returns"."total_amount")),
	CONSTRAINT "supplier_returns_refund_wallet_ck" CHECK (("supplier_returns"."refund_amount" = 0 AND "supplier_returns"."refund_wallet_id" IS NULL) OR ("supplier_returns"."refund_amount" > 0 AND "supplier_returns"."refund_wallet_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "returned_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_credit_movements" ADD CONSTRAINT "supplier_credit_movements_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_movements" ADD CONSTRAINT "supplier_credit_movements_supplier_return_id_supplier_returns_id_fk" FOREIGN KEY ("supplier_return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_movements" ADD CONSTRAINT "supplier_credit_movements_purchase_id_purchase_records_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_movements" ADD CONSTRAINT "supplier_credit_movements_supplier_payment_id_supplier_payments_id_fk" FOREIGN KEY ("supplier_payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_movements" ADD CONSTRAINT "supplier_credit_movements_performed_by_id_user_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_id_purchase_records_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_dispatched_by_id_user_id_fk" FOREIGN KEY ("dispatched_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_completed_by_id_user_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_refund_wallet_id_wallets_id_fk" FOREIGN KEY ("refund_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_refund_transaction_id_transactions_id_fk" FOREIGN KEY ("refund_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_cancelled_by_id_user_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_voided_by_id_user_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_credit_supplier_idx" ON "supplier_credit_movements" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_returns_number_unique_idx" ON "supplier_returns" USING btree ("return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_returns_debit_note_unique_idx" ON "supplier_returns" USING btree ("debit_note_number") WHERE "supplier_returns"."debit_note_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "supplier_returns_supplier_status_idx" ON "supplier_returns" USING btree ("supplier_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "supplier_returns_purchase_idx" ON "supplier_returns" USING btree ("purchase_id");--> statement-breakpoint
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_returned_amount_ck" CHECK ("purchase_records"."returned_amount" >= 0);