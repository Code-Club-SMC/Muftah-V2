ALTER TABLE "invoice_items" ADD COLUMN "charged_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "dispatched_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "fill_amount_snapshot" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "fill_unit_snapshot" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stock_warehouse_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_stock_warehouse_id_warehouses_id_fk" FOREIGN KEY ("stock_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;