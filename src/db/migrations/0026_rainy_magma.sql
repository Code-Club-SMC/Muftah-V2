CREATE TABLE "sales_return_reasons" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_returns" ALTER COLUMN "status" SET DEFAULT 'requested';--> statement-breakpoint
ALTER TABLE "chemical_lab_reports" ADD COLUMN "purchase_id" text;--> statement-breakpoint
ALTER TABLE "packaging_materials" ADD COLUMN "packaging_kind" text;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD COLUMN "customer_details" jsonb;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD COLUMN "invoice_discount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD COLUMN "invoice_discount_description" text;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD COLUMN "expenses" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD COLUMN "expenses_description" text;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD COLUMN "printed_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "offline_sales_staged_items" ADD COLUMN "manual_free_cartons" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_items" ADD COLUMN "is_price_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_items" ADD COLUMN "listed_carton_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "offline_sales_staged_payments" ADD COLUMN "expense_type" text;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_payments" ADD COLUMN "expense_employee_id" text;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_payments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_payments" ADD COLUMN "instant_verify" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "cartons_requested" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "quantity_requested" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "good_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "damaged_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "expired_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_stock_traces" ADD COLUMN "kind" text DEFAULT 'receive' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "reason_id" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "reason_note" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "received_by_id" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "cancelled_by_id" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "voided_by_id" text;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "voided_by_id" text;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "void_refund_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "void_refund_wallet_id" text;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "void_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_return_reasons_name" ON "sales_return_reasons" USING btree ("name");--> statement-breakpoint
ALTER TABLE "chemical_lab_reports" ADD CONSTRAINT "chemical_lab_reports_purchase_id_purchase_records_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_reason_id_sales_return_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."sales_return_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_received_by_id_user_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_cancelled_by_id_user_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_voided_by_id_user_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_offline_sales_slot_id_offline_sales_invoice_slots_id_fk" FOREIGN KEY ("offline_sales_slot_id") REFERENCES "public"."offline_sales_invoice_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_records_voided_by_id_user_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_records_void_refund_wallet_id_wallets_id_fk" FOREIGN KEY ("void_refund_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_report_purchase_idx" ON "chemical_lab_reports" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "idx_sales_returns_reason" ON "sales_returns" USING btree ("reason_id");--> statement-breakpoint
CREATE INDEX "purchase_active_supplier_idx" ON "purchase_records" USING btree ("supplier_id","purchase_date") WHERE "purchase_records"."voided_at" is null;--> statement-breakpoint
ALTER TABLE "packaging_materials" ADD CONSTRAINT "packaging_materials_kind_check" CHECK ("packaging_materials"."packaging_kind" IS NULL OR "packaging_materials"."packaging_kind" IN ('bottle', 'jerry_can', 'sachet', 'pouch', 'shopper', 'carton', 'bucket', 'cap', 'sticker', 'other'));--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD CONSTRAINT "offline_sales_staged_extras_check" CHECK ("offline_sales_staged_invoices"."invoice_discount" >= 0 and "offline_sales_staged_invoices"."expenses" >= 0);--> statement-breakpoint
ALTER TABLE "offline_sales_staged_items" ADD CONSTRAINT "offline_sales_staged_items_manual_free_check" CHECK ("offline_sales_staged_items"."manual_free_cartons" >= 0);--> statement-breakpoint
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_void_refund_bounds" CHECK ("purchase_records"."void_refund_amount" >= 0 AND "purchase_records"."void_refund_amount" <= "purchase_records"."paid_amount");--> statement-breakpoint
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_void_metadata" CHECK ((
      ("purchase_records"."voided_at" IS NULL AND "purchase_records"."voided_by_id" IS NULL AND "purchase_records"."void_reason" IS NULL
        AND "purchase_records"."void_refund_amount" IS NULL AND "purchase_records"."void_refund_wallet_id" IS NULL AND "purchase_records"."void_snapshot" IS NULL)
      OR
      ("purchase_records"."voided_at" IS NOT NULL AND "purchase_records"."voided_by_id" IS NOT NULL AND "purchase_records"."void_reason" IS NOT NULL
        AND length(btrim("purchase_records"."void_reason")) BETWEEN 1 AND 1000
        AND "purchase_records"."void_refund_amount" IS NOT NULL AND "purchase_records"."void_snapshot" IS NOT NULL
        AND (("purchase_records"."void_refund_amount" = 0 AND "purchase_records"."void_refund_wallet_id" IS NULL)
          OR ("purchase_records"."void_refund_amount" > 0 AND "purchase_records"."void_refund_wallet_id" IS NOT NULL)))
    ));