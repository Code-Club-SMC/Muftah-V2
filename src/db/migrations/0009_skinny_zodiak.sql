CREATE TABLE "formula_ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"formula_id" text NOT NULL,
	"chemical_id" text NOT NULL,
	"quantity_per_batch" numeric(10, 3) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formulas" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"batch_size" numeric(10, 2) NOT NULL,
	"batch_unit" text DEFAULT 'kg' NOT NULL,
	"estimated_ingredients_cost" numeric(12, 2),
	"min_batch_yield" numeric(5, 2),
	"production_instructions" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mixing_materials_used" (
	"id" text PRIMARY KEY NOT NULL,
	"mixing_run_id" text NOT NULL,
	"chemical_id" text NOT NULL,
	"quantity_used" numeric(12, 3) NOT NULL,
	"cost_per_unit" numeric(10, 2) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mixing_progress_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"mixing_run_id" text NOT NULL,
	"quantity_produced" numeric(12, 3) NOT NULL,
	"original_quantity_produced" numeric(12, 3),
	"created_by_id" text NOT NULL,
	"edited_by_id" text,
	"edit_reason" text,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mixing_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"formula_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"initiator_id" text,
	"target_bulk_quantity" numeric(12, 3) NOT NULL,
	"actual_bulk_produced" numeric(12, 3) DEFAULT '0',
	"bulk_unit" text NOT NULL,
	"total_chemical_cost" numeric(12, 2) DEFAULT '0',
	"chemical_cost_per_unit" numeric(10, 4) DEFAULT '0',
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_start_date" timestamp,
	"actual_start_date" timestamp,
	"actual_completion_date" timestamp,
	"yield_percentage" numeric(5, 2),
	"shortfall_quantity" numeric(12, 3) DEFAULT '0',
	"shortfall_reason" text,
	"closed_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mixing_runs_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "packaging_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"mixing_run_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"initiator_id" text,
	"allocated_bulk_quantity" numeric(12, 3) NOT NULL,
	"allocated_bulk_unit" text NOT NULL,
	"allocated_chemical_cost" numeric(12, 2) NOT NULL,
	"target_containers" integer NOT NULL,
	"target_cartons" integer DEFAULT 0,
	"target_loose_units" integer DEFAULT 0,
	"completed_containers" integer DEFAULT 0,
	"actual_bulk_consumed" numeric(12, 3) DEFAULT '0',
	"actual_cartons_produced" integer DEFAULT 0,
	"actual_packs_produced" integer DEFAULT 0,
	"actual_loose_units_produced" integer DEFAULT 0,
	"total_packaging_cost" numeric(12, 2) DEFAULT '0',
	"total_production_cost" numeric(12, 2) DEFAULT '0',
	"actual_cost_per_pack" numeric(10, 4) DEFAULT '0',
	"actual_cost_per_carton" numeric(10, 4) DEFAULT '0',
	"status" text DEFAULT 'allocated' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"closed_by" text,
	"shortfall_units" integer DEFAULT 0,
	"shortfall_reason" text,
	"yield_variance_cartons" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packaging_materials_used_in_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"packaging_allocation_id" text NOT NULL,
	"progress_log_id" text,
	"material_id" text NOT NULL,
	"quantity_used" numeric(12, 3) NOT NULL,
	"cost_per_unit" numeric(10, 2) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packaging_progress_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"packaging_allocation_id" text NOT NULL,
	"containers_produced" integer NOT NULL,
	"bulk_consumed" numeric(12, 3) NOT NULL,
	"original_containers_produced" integer,
	"created_by_id" text NOT NULL,
	"edited_by_id" text,
	"edit_reason" text,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_run_lab_reports" ALTER COLUMN "production_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cartons" ALTER COLUMN "production_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "production_run_lab_reports" ADD COLUMN "mixing_run_id" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "formula_id" text;--> statement-breakpoint
ALTER TABLE "wac_history" ADD COLUMN "packaging_allocation_id" text;--> statement-breakpoint
ALTER TABLE "wac_history" ADD COLUMN "mixing_run_id" text;--> statement-breakpoint
ALTER TABLE "adjustment_log" ADD COLUMN "packaging_allocation_id" text;--> statement-breakpoint
ALTER TABLE "cartons" ADD COLUMN "packaging_allocation_id" text;--> statement-breakpoint
ALTER TABLE "formula_ingredients" ADD CONSTRAINT "formula_ingredients_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_ingredients" ADD CONSTRAINT "formula_ingredients_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_materials_used" ADD CONSTRAINT "mixing_materials_used_mixing_run_id_mixing_runs_id_fk" FOREIGN KEY ("mixing_run_id") REFERENCES "public"."mixing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_materials_used" ADD CONSTRAINT "mixing_materials_used_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_progress_logs" ADD CONSTRAINT "mixing_progress_logs_mixing_run_id_mixing_runs_id_fk" FOREIGN KEY ("mixing_run_id") REFERENCES "public"."mixing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_progress_logs" ADD CONSTRAINT "mixing_progress_logs_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_progress_logs" ADD CONSTRAINT "mixing_progress_logs_edited_by_id_user_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_runs" ADD CONSTRAINT "mixing_runs_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_runs" ADD CONSTRAINT "mixing_runs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_runs" ADD CONSTRAINT "mixing_runs_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_runs" ADD CONSTRAINT "mixing_runs_initiator_id_user_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixing_runs" ADD CONSTRAINT "mixing_runs_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD CONSTRAINT "packaging_allocations_mixing_run_id_mixing_runs_id_fk" FOREIGN KEY ("mixing_run_id") REFERENCES "public"."mixing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD CONSTRAINT "packaging_allocations_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD CONSTRAINT "packaging_allocations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD CONSTRAINT "packaging_allocations_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD CONSTRAINT "packaging_allocations_initiator_id_user_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_allocations" ADD CONSTRAINT "packaging_allocations_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_materials_used_in_allocation" ADD CONSTRAINT "packaging_materials_used_in_allocation_packaging_allocation_id_packaging_allocations_id_fk" FOREIGN KEY ("packaging_allocation_id") REFERENCES "public"."packaging_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_materials_used_in_allocation" ADD CONSTRAINT "packaging_materials_used_in_allocation_progress_log_id_packaging_progress_logs_id_fk" FOREIGN KEY ("progress_log_id") REFERENCES "public"."packaging_progress_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_materials_used_in_allocation" ADD CONSTRAINT "packaging_materials_used_in_allocation_material_id_packaging_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_progress_logs" ADD CONSTRAINT "packaging_progress_logs_packaging_allocation_id_packaging_allocations_id_fk" FOREIGN KEY ("packaging_allocation_id") REFERENCES "public"."packaging_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_progress_logs" ADD CONSTRAINT "packaging_progress_logs_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_progress_logs" ADD CONSTRAINT "packaging_progress_logs_edited_by_id_user_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "formula_ingredients_formula_idx" ON "formula_ingredients" USING btree ("formula_id");--> statement-breakpoint
CREATE INDEX "mixing_materials_mixing_run_idx" ON "mixing_materials_used" USING btree ("mixing_run_id");--> statement-breakpoint
CREATE INDEX "mixing_progress_run_created_at_idx" ON "mixing_progress_logs" USING btree ("mixing_run_id","created_at");--> statement-breakpoint
CREATE INDEX "mixing_runs_updated_at_idx" ON "mixing_runs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "mixing_runs_formula_status_idx" ON "mixing_runs" USING btree ("formula_id","status");--> statement-breakpoint
CREATE INDEX "pkg_alloc_mixing_run_idx" ON "packaging_allocations" USING btree ("mixing_run_id");--> statement-breakpoint
CREATE INDEX "pkg_alloc_recipe_idx" ON "packaging_allocations" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "pkg_alloc_status_idx" ON "packaging_allocations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pkg_mat_used_allocation_idx" ON "packaging_materials_used_in_allocation" USING btree ("packaging_allocation_id");--> statement-breakpoint
CREATE INDEX "pkg_mat_used_progress_log_idx" ON "packaging_materials_used_in_allocation" USING btree ("progress_log_id");--> statement-breakpoint
CREATE INDEX "pkg_progress_allocation_created_at_idx" ON "packaging_progress_logs" USING btree ("packaging_allocation_id","created_at");