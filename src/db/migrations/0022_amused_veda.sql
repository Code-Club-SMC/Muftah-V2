CREATE TABLE "material_lot_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"delta" numeric(12, 3) NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_lot_stock" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "material_lot_stock_quantity_ck" CHECK ("material_lot_stock"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"chemical_id" text,
	"packaging_material_id" text,
	"unit_price" numeric(12, 2) NOT NULL,
	"first_purchased_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "material_lots_one_material_ck" CHECK (("material_lots"."chemical_id" IS NOT NULL) <> ("material_lots"."packaging_material_id" IS NOT NULL)),
	CONSTRAINT "material_lots_price_ck" CHECK ("material_lots"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_audit_log" ADD COLUMN "lot_id" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "lot_id" text;--> statement-breakpoint
ALTER TABLE "mixing_materials_used" ADD COLUMN "lot_id" text;--> statement-breakpoint
ALTER TABLE "packaging_materials_used_in_allocation" ADD COLUMN "lot_id" text;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "lot_id" text;--> statement-breakpoint
ALTER TABLE "material_lot_movements" ADD CONSTRAINT "material_lot_movements_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot_movements" ADD CONSTRAINT "material_lot_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot_stock" ADD CONSTRAINT "material_lot_stock_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lot_stock" ADD CONSTRAINT "material_lot_stock_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_lot_movements_lot_warehouse_idx" ON "material_lot_movements" USING btree ("lot_id","warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "material_lot_movements_source_idx" ON "material_lot_movements" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_lot_stock_lot_warehouse_unique_idx" ON "material_lot_stock" USING btree ("lot_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "material_lot_stock_warehouse_idx" ON "material_lot_stock" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_lots_chemical_price_unique_idx" ON "material_lots" USING btree ("chemical_id","unit_price") WHERE "material_lots"."chemical_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_lots_packaging_price_unique_idx" ON "material_lots" USING btree ("packaging_material_id","unit_price") WHERE "material_lots"."packaging_material_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_audit_log" ADD CONSTRAINT "inventory_audit_log_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_materials_used" ADD CONSTRAINT "mixing_materials_used_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_materials_used_in_allocation" ADD CONSTRAINT "packaging_materials_used_in_allocation_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_records_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;