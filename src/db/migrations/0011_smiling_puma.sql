CREATE TABLE "offline_sales_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"workbook_id" text,
	"original_filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"outage_started_at" timestamp with time zone NOT NULL,
	"outage_ended_at" timestamp with time zone NOT NULL,
	"outage_reason" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"total_invoices" integer DEFAULT 0 NOT NULL,
	"ready_invoices" integer DEFAULT 0 NOT NULL,
	"warning_invoices" integer DEFAULT 0 NOT NULL,
	"duplicate_invoices" integer DEFAULT 0 NOT NULL,
	"invalid_invoices" integer DEFAULT 0 NOT NULL,
	"needs_review_invoices" integer DEFAULT 0 NOT NULL,
	"posted_invoices" integer DEFAULT 0 NOT NULL,
	"excluded_invoices" integer DEFAULT 0 NOT NULL,
	"processing_lease_id" text,
	"processing_lease_expires_at" timestamp with time zone,
	"last_error" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sales_batches_size_check" CHECK ("offline_sales_import_batches"."byte_size" > 0),
	CONSTRAINT "offline_sales_batches_outage_range_check" CHECK ("offline_sales_import_batches"."outage_started_at" < "offline_sales_import_batches"."outage_ended_at"),
	CONSTRAINT "offline_sales_batches_counts_check" CHECK ("offline_sales_import_batches"."total_invoices" >= 0 and "offline_sales_import_batches"."ready_invoices" >= 0 and "offline_sales_import_batches"."warning_invoices" >= 0 and "offline_sales_import_batches"."duplicate_invoices" >= 0 and "offline_sales_import_batches"."invalid_invoices" >= 0 and "offline_sales_import_batches"."needs_review_invoices" >= 0 and "offline_sales_import_batches"."posted_invoices" >= 0 and "offline_sales_import_batches"."excluded_invoices" >= 0),
	CONSTRAINT "offline_sales_batches_workbook_required_check" CHECK ("offline_sales_import_batches"."status" = 'rejected' or "offline_sales_import_batches"."workbook_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "offline_sales_invoice_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"workbook_id" text NOT NULL,
	"slot_number" integer NOT NULL,
	"reserved_serial" integer NOT NULL,
	"record_token" text NOT NULL,
	"status" text DEFAULT 'unused' NOT NULL,
	"staged_content_hash" text,
	"staged_invoice_id" text,
	"posted_invoice_id" text,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sales_slots_numbers_check" CHECK ("offline_sales_invoice_slots"."slot_number" > 0 and "offline_sales_invoice_slots"."reserved_serial" > 0)
);
--> statement-breakpoint
CREATE TABLE "offline_sales_staged_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"workbook_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"record_token" text NOT NULL,
	"invoice_number" text NOT NULL,
	"content_hash" text NOT NULL,
	"worksheet_row_number" integer NOT NULL,
	"sale_type" text NOT NULL,
	"business_date" timestamp with time zone NOT NULL,
	"distributor_code" text,
	"customer_id" text,
	"order_booker_code" text,
	"bill_number" integer,
	"order_id" text,
	"payment_due_date" timestamp with time zone,
	"remarks" text,
	"invoice_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"pending_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"outstanding_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"issue_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings_acknowledged" boolean DEFAULT false NOT NULL,
	"review_resolution" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"posted_invoice_id" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sales_staged_amounts_check" CHECK ("offline_sales_staged_invoices"."invoice_amount" >= 0 and "offline_sales_staged_invoices"."paid_amount" >= 0 and "offline_sales_staged_invoices"."pending_amount" >= 0 and "offline_sales_staged_invoices"."outstanding_amount" >= 0 and "offline_sales_staged_invoices"."paid_amount" + "offline_sales_staged_invoices"."outstanding_amount" = "offline_sales_staged_invoices"."invoice_amount" and "offline_sales_staged_invoices"."pending_amount" <= "offline_sales_staged_invoices"."outstanding_amount"),
	CONSTRAINT "offline_sales_staged_row_check" CHECK ("offline_sales_staged_invoices"."worksheet_row_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "offline_sales_staged_items" (
	"id" text PRIMARY KEY NOT NULL,
	"staged_invoice_id" text NOT NULL,
	"worksheet_row_number" integer NOT NULL,
	"product_code" text NOT NULL,
	"recipe_id" text,
	"carton_quantity" integer NOT NULL,
	"loose_unit_quantity" integer NOT NULL,
	"packs_per_carton" integer NOT NULL,
	"base_carton_price" numeric(12, 2) NOT NULL,
	"free_cartons" integer DEFAULT 0 NOT NULL,
	"charged_units" integer NOT NULL,
	"dispatched_units" integer NOT NULL,
	"line_amount" numeric(12, 2) NOT NULL,
	"wac_per_pack" numeric(12, 4) NOT NULL,
	"stock_units_snapshot" integer NOT NULL,
	"physical_stock_confirmed" boolean DEFAULT false NOT NULL,
	"source_columns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sales_staged_items_quantities_check" CHECK ("offline_sales_staged_items"."worksheet_row_number" > 0 and "offline_sales_staged_items"."carton_quantity" >= 0 and "offline_sales_staged_items"."loose_unit_quantity" >= 0 and "offline_sales_staged_items"."packs_per_carton" > 0 and "offline_sales_staged_items"."free_cartons" >= 0 and "offline_sales_staged_items"."charged_units" >= 0 and "offline_sales_staged_items"."dispatched_units" >= 0 and "offline_sales_staged_items"."base_carton_price" >= 0 and "offline_sales_staged_items"."line_amount" >= 0 and "offline_sales_staged_items"."wac_per_pack" >= 0 and "offline_sales_staged_items"."stock_units_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "offline_sales_staged_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"staged_invoice_id" text NOT NULL,
	"worksheet_row_number" integer NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"wallet_code" text NOT NULL,
	"wallet_id" text,
	"reference" text,
	"cheque_number" text,
	"cheque_bank" text,
	"cheque_date" timestamp with time zone,
	"payment_date" timestamp with time zone NOT NULL,
	"source_columns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sales_staged_payments_amount_check" CHECK ("offline_sales_staged_payments"."worksheet_row_number" > 0 and "offline_sales_staged_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "offline_sales_workbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_code" text NOT NULL,
	"operator_user_id" text NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"template_version" integer NOT NULL,
	"signing_version" integer NOT NULL,
	"invoice_capacity" integer NOT NULL,
	"item_capacity" integer NOT NULL,
	"payment_capacity" integer NOT NULL,
	"reference_snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"snapshot_signature" text NOT NULL,
	"manifest_signature" text NOT NULL,
	"replacement_workbook_id" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"force_retired_by_user_id" text,
	"force_retired_at" timestamp with time zone,
	"force_retired_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_sales_workbooks_factory_check" CHECK ("offline_sales_workbooks"."factory_code" = 'F01'),
	CONSTRAINT "offline_sales_workbooks_capacities_check" CHECK ("offline_sales_workbooks"."template_version" > 0 and "offline_sales_workbooks"."signing_version" > 0 and "offline_sales_workbooks"."invoice_capacity" > 0 and "offline_sales_workbooks"."item_capacity" > 0 and "offline_sales_workbooks"."payment_capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reconciliation_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"invoice_item_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"requested_units" integer NOT NULL,
	"available_units" integer NOT NULL,
	"deficit_units" integer NOT NULL,
	"snapshot_stock_units" integer NOT NULL,
	"live_stock_units" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" text,
	"resolution_reason" text,
	"resolution_reference" text,
	"resolution_type" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reconciliation_issues_deficit_check" CHECK ("stock_reconciliation_issues"."requested_units" > 0 and "stock_reconciliation_issues"."available_units" >= 0 and "stock_reconciliation_issues"."deficit_units" > 0 and "stock_reconciliation_issues"."deficit_units" = "stock_reconciliation_issues"."requested_units" - "stock_reconciliation_issues"."available_units"),
	CONSTRAINT "stock_reconciliation_issues_resolution_check" CHECK ((
		"stock_reconciliation_issues"."status" = 'open' and "stock_reconciliation_issues"."resolved_by_user_id" is null and "stock_reconciliation_issues"."resolution_reason" is null and "stock_reconciliation_issues"."resolution_reference" is null and "stock_reconciliation_issues"."resolution_type" is null and "stock_reconciliation_issues"."resolved_at" is null
	) or (
		"stock_reconciliation_issues"."status" = 'resolved' and "stock_reconciliation_issues"."resolved_by_user_id" is not null and nullif(btrim("stock_reconciliation_issues"."resolution_reason"), '') is not null and nullif(btrim("stock_reconciliation_issues"."resolution_reference"), '') is not null and "stock_reconciliation_issues"."resolution_type" in ('counted_adjustment', 'missing_record') and "stock_reconciliation_issues"."resolved_at" is not null
	))
);
--> statement-breakpoint
ALTER TABLE "commission_records" ADD COLUMN "earned_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "offline_sales_slot_id" text;--> statement-breakpoint
ALTER TABLE "offline_sales_import_batches" ADD CONSTRAINT "offline_sales_import_batches_workbook_id_offline_sales_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."offline_sales_workbooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_import_batches" ADD CONSTRAINT "offline_sales_import_batches_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_import_batches" ADD CONSTRAINT "offline_sales_import_batches_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_invoice_slots" ADD CONSTRAINT "offline_sales_invoice_slots_workbook_id_offline_sales_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."offline_sales_workbooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_invoice_slots" ADD CONSTRAINT "offline_sales_invoice_slots_staged_invoice_id_offline_sales_staged_invoices_id_fk" FOREIGN KEY ("staged_invoice_id") REFERENCES "public"."offline_sales_staged_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_invoice_slots" ADD CONSTRAINT "offline_sales_invoice_slots_posted_invoice_id_invoices_id_fk" FOREIGN KEY ("posted_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD CONSTRAINT "offline_sales_staged_invoices_batch_id_offline_sales_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."offline_sales_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD CONSTRAINT "offline_sales_staged_invoices_workbook_id_offline_sales_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."offline_sales_workbooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD CONSTRAINT "offline_sales_staged_invoices_slot_id_offline_sales_invoice_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."offline_sales_invoice_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD CONSTRAINT "offline_sales_staged_invoices_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_invoices" ADD CONSTRAINT "offline_sales_staged_invoices_posted_invoice_id_invoices_id_fk" FOREIGN KEY ("posted_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_items" ADD CONSTRAINT "offline_sales_staged_items_staged_invoice_id_offline_sales_staged_invoices_id_fk" FOREIGN KEY ("staged_invoice_id") REFERENCES "public"."offline_sales_staged_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_items" ADD CONSTRAINT "offline_sales_staged_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_payments" ADD CONSTRAINT "offline_sales_staged_payments_staged_invoice_id_offline_sales_staged_invoices_id_fk" FOREIGN KEY ("staged_invoice_id") REFERENCES "public"."offline_sales_staged_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_staged_payments" ADD CONSTRAINT "offline_sales_staged_payments_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_workbooks" ADD CONSTRAINT "offline_sales_workbooks_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_workbooks" ADD CONSTRAINT "offline_sales_workbooks_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_workbooks" ADD CONSTRAINT "offline_sales_workbooks_replacement_workbook_id_offline_sales_workbooks_id_fk" FOREIGN KEY ("replacement_workbook_id") REFERENCES "public"."offline_sales_workbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_workbooks" ADD CONSTRAINT "offline_sales_workbooks_closed_by_user_id_user_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales_workbooks" ADD CONSTRAINT "offline_sales_workbooks_force_retired_by_user_id_user_id_fk" FOREIGN KEY ("force_retired_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reconciliation_issues" ADD CONSTRAINT "stock_reconciliation_issues_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reconciliation_issues" ADD CONSTRAINT "stock_reconciliation_issues_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reconciliation_issues" ADD CONSTRAINT "stock_reconciliation_issues_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reconciliation_issues" ADD CONSTRAINT "stock_reconciliation_issues_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reconciliation_issues" ADD CONSTRAINT "stock_reconciliation_issues_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_batches_file_hash_idx" ON "offline_sales_import_batches" USING btree ("file_sha256");--> statement-breakpoint
CREATE INDEX "offline_sales_batches_workbook_status_idx" ON "offline_sales_import_batches" USING btree ("workbook_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_slots_token_idx" ON "offline_sales_invoice_slots" USING btree ("record_token");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_slots_serial_idx" ON "offline_sales_invoice_slots" USING btree ("reserved_serial");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_slots_workbook_slot_idx" ON "offline_sales_invoice_slots" USING btree ("workbook_id","slot_number");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_slots_staged_invoice_idx" ON "offline_sales_invoice_slots" USING btree ("staged_invoice_id") WHERE "offline_sales_invoice_slots"."staged_invoice_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_slots_posted_invoice_idx" ON "offline_sales_invoice_slots" USING btree ("posted_invoice_id") WHERE "offline_sales_invoice_slots"."posted_invoice_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_staged_workbook_token_idx" ON "offline_sales_staged_invoices" USING btree ("workbook_id","record_token");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_staged_invoice_number_idx" ON "offline_sales_staged_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_staged_posted_invoice_idx" ON "offline_sales_staged_invoices" USING btree ("posted_invoice_id") WHERE "offline_sales_staged_invoices"."posted_invoice_id" is not null;--> statement-breakpoint
CREATE INDEX "offline_sales_staged_batch_status_idx" ON "offline_sales_staged_invoices" USING btree ("batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_staged_items_invoice_row_idx" ON "offline_sales_staged_items" USING btree ("staged_invoice_id","worksheet_row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_staged_payments_invoice_row_idx" ON "offline_sales_staged_payments" USING btree ("staged_invoice_id","worksheet_row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sales_workbooks_one_active_factory_idx" ON "offline_sales_workbooks" USING btree ("factory_code") WHERE "offline_sales_workbooks"."status" = 'active';--> statement-breakpoint
CREATE INDEX "offline_sales_workbooks_operator_idx" ON "offline_sales_workbooks" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX "stock_reconciliation_issues_status_idx" ON "stock_reconciliation_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stock_reconciliation_issues_invoice_idx" ON "stock_reconciliation_issues" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_offline_sales_slot_id_offline_sales_invoice_slots_id_fk" FOREIGN KEY ("offline_sales_slot_id") REFERENCES "public"."offline_sales_invoice_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_offline_sales_slot_unique" ON "invoices" USING btree ("offline_sales_slot_id") WHERE "invoices"."offline_sales_slot_id" is not null;--> statement-breakpoint
CREATE FUNCTION "prevent_offline_sales_posted_link_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.posted_invoice_id IS NOT NULL AND NEW.posted_invoice_id IS DISTINCT FROM OLD.posted_invoice_id THEN
		RAISE EXCEPTION 'posted offline invoice link is immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "offline_sales_slots_posted_link_immutable" BEFORE UPDATE ON "offline_sales_invoice_slots" FOR EACH ROW EXECUTE FUNCTION "prevent_offline_sales_posted_link_change"();--> statement-breakpoint
CREATE TRIGGER "offline_sales_staged_posted_link_immutable" BEFORE UPDATE ON "offline_sales_staged_invoices" FOR EACH ROW EXECUTE FUNCTION "prevent_offline_sales_posted_link_change"();--> statement-breakpoint
CREATE FUNCTION "prevent_invoice_offline_slot_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.offline_sales_slot_id IS NOT NULL AND NEW.offline_sales_slot_id IS DISTINCT FROM OLD.offline_sales_slot_id THEN
		RAISE EXCEPTION 'invoice offline slot link is immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "invoices_offline_slot_immutable" BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION "prevent_invoice_offline_slot_change"();
