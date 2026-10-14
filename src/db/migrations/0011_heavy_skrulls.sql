DROP INDEX "fg_warehouse_recipe_idx";--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ALTER COLUMN "production_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ALTER COLUMN "production_material_used_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD COLUMN "mixing_run_id" text;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD COLUMN "mixing_material_used_id" text;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD CONSTRAINT "failed_production_chemical_recoveries_mixing_run_id_mixing_runs_id_fk" FOREIGN KEY ("mixing_run_id") REFERENCES "public"."mixing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD CONSTRAINT "failed_production_chemical_recoveries_mixing_material_used_id_mixing_materials_used_id_fk" FOREIGN KEY ("mixing_material_used_id") REFERENCES "public"."mixing_materials_used"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "failed_prod_recovery_mixing_chemical_unique_idx" ON "failed_production_chemical_recoveries" USING btree ("mixing_run_id","chemical_id") WHERE "failed_production_chemical_recoveries"."mixing_run_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_warehouse_chemical_unique_idx" ON "material_stock" USING btree ("warehouse_id","chemical_id") WHERE "material_stock"."chemical_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_warehouse_packaging_unique_idx" ON "material_stock" USING btree ("warehouse_id","packaging_material_id") WHERE "material_stock"."packaging_material_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fg_warehouse_recipe_idx" ON "finished_goods_stock" USING btree ("warehouse_id","recipe_id");