CREATE TABLE "material_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"material_type" text NOT NULL,
	"chemical_id" text,
	"packaging_material_id" text,
	"lot_id" text NOT NULL,
	"delta" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"source" text NOT NULL,
	"performed_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mixing_material_use" (
	"id" text PRIMARY KEY NOT NULL,
	"mixing_run_id" text NOT NULL,
	"chemical_id" text NOT NULL,
	"formula_quantity" numeric(12, 3) NOT NULL,
	"used_quantity" numeric(12, 3) NOT NULL,
	"extra_quantity" numeric(12, 3) NOT NULL,
	"extra_cost" numeric(12, 2) NOT NULL,
	"reason" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packing_material_use" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"material_id" text NOT NULL,
	"measured_in_kg" boolean NOT NULL,
	"needed_quantity" numeric(12, 3) NOT NULL,
	"used_quantity" numeric(12, 3) NOT NULL,
	"extra_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"extra_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"reason" text,
	"note" text,
	"shopper_weight_grams" numeric(10, 3),
	"expected_shoppers" integer,
	"actual_shoppers" integer,
	"loss_shoppers" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packaging_materials" ADD COLUMN "measured_in_kg" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_packing_receipts" ADD COLUMN "loss_reason_code" text;--> statement-breakpoint
ALTER TABLE "mixing_materials_used" ADD COLUMN "use_type" text DEFAULT 'formula' NOT NULL;--> statement-breakpoint
ALTER TABLE "mixing_runs" ADD COLUMN "shortfall_reason_code" text;--> statement-breakpoint
ALTER TABLE "material_adjustments" ADD CONSTRAINT "material_adjustments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_adjustments" ADD CONSTRAINT "material_adjustments_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_adjustments" ADD CONSTRAINT "material_adjustments_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_adjustments" ADD CONSTRAINT "material_adjustments_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_adjustments" ADD CONSTRAINT "material_adjustments_performed_by_id_user_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_material_use" ADD CONSTRAINT "mixing_material_use_mixing_run_id_mixing_runs_id_fk" FOREIGN KEY ("mixing_run_id") REFERENCES "public"."mixing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_material_use" ADD CONSTRAINT "mixing_material_use_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_material_use" ADD CONSTRAINT "packing_material_use_receipt_id_batch_packing_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."batch_packing_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_material_use" ADD CONSTRAINT "packing_material_use_material_id_packaging_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_adjustments_warehouse_created_idx" ON "material_adjustments" USING btree ("warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "material_adjustments_reason_idx" ON "material_adjustments" USING btree ("reason");--> statement-breakpoint
CREATE UNIQUE INDEX "mixing_material_use_run_chemical_idx" ON "mixing_material_use" USING btree ("mixing_run_id","chemical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "packing_material_use_receipt_material_idx" ON "packing_material_use" USING btree ("receipt_id","material_id");