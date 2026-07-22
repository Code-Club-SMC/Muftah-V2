CREATE TABLE "failed_production_chemical_recoveries" (
	"id" text PRIMARY KEY NOT NULL,
	"production_run_id" text NOT NULL,
	"production_material_used_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"chemical_id" text NOT NULL,
	"expected_quantity" numeric(12, 3) NOT NULL,
	"recovered_quantity" numeric(12, 3) NOT NULL,
	"loss_quantity" numeric(12, 3) NOT NULL,
	"cost_per_unit" numeric(10, 2) NOT NULL,
	"loss_amount" numeric(12, 2) NOT NULL,
	"notes" text,
	"settled_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD CONSTRAINT "failed_production_chemical_recoveries_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD CONSTRAINT "failed_production_chemical_recoveries_production_material_used_id_production_materials_used_id_fk" FOREIGN KEY ("production_material_used_id") REFERENCES "public"."production_materials_used"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD CONSTRAINT "failed_production_chemical_recoveries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD CONSTRAINT "failed_production_chemical_recoveries_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_production_chemical_recoveries" ADD CONSTRAINT "failed_production_chemical_recoveries_settled_by_id_user_id_fk" FOREIGN KEY ("settled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "failed_prod_recovery_run_chemical_idx" ON "failed_production_chemical_recoveries" USING btree ("production_run_id","chemical_id");--> statement-breakpoint
CREATE INDEX "failed_prod_recovery_created_at_idx" ON "failed_production_chemical_recoveries" USING btree ("created_at");