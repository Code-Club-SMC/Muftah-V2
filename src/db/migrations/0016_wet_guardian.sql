CREATE TABLE "batch_packing_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"mixing_run_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_payload" text NOT NULL,
	"actor_id" text NOT NULL,
	"packed_at" timestamp NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"bulk_consumed" numeric(12, 3) NOT NULL,
	"loss_bulk" numeric(12, 3) NOT NULL,
	"loss_reason" text,
	"total_packs" integer NOT NULL,
	"cost_audit" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outside_pack_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"reference_id" text NOT NULL,
	"type" text NOT NULL,
	"delta" integer NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finished_goods_stock" ADD COLUMN "quantity_outside_packs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD COLUMN "packing_receipt_id" text;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD COLUMN "format_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD COLUMN "full_cartons_recorded" integer;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD COLUMN "partial_packs_recorded" integer;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD COLUMN "outside_packs_recorded" integer;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD COLUMN "nominal_bulk_recorded" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD COLUMN "variance_reason" text;--> statement-breakpoint
ALTER TABLE "batch_packing_receipts" ADD CONSTRAINT "batch_packing_receipts_mixing_run_id_mixing_runs_id_fk" FOREIGN KEY ("mixing_run_id") REFERENCES "public"."mixing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_packing_receipts" ADD CONSTRAINT "batch_packing_receipts_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outside_pack_movements" ADD CONSTRAINT "outside_pack_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outside_pack_movements" ADD CONSTRAINT "outside_pack_movements_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outside_pack_movements" ADD CONSTRAINT "outside_pack_movements_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_packing_request_idx" ON "batch_packing_receipts" USING btree ("mixing_run_id","request_id");--> statement-breakpoint
CREATE INDEX "outside_pack_reference_idx" ON "outside_pack_movements" USING btree ("reference_id","recipe_id");--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD CONSTRAINT "packaging_allocations_packing_receipt_id_batch_packing_receipts_id_fk" FOREIGN KEY ("packing_receipt_id") REFERENCES "public"."batch_packing_receipts"("id") ON DELETE no action ON UPDATE no action;