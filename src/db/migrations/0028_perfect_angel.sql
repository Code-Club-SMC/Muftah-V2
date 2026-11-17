ALTER TABLE "other_income" ADD COLUMN "chemical_id" text;--> statement-breakpoint
ALTER TABLE "other_income" ADD COLUMN "packaging_material_id" text;--> statement-breakpoint
ALTER TABLE "other_income" ADD COLUMN "container_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "other_income" ADD COLUMN "container_size" numeric(12, 3) NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "by_product_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "container_name" text;--> statement-breakpoint
ALTER TABLE "purchase_records" ADD COLUMN "container_size" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_chemical_id_chemicals_id_fk" FOREIGN KEY ("chemical_id") REFERENCES "public"."chemicals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "other_income_chemical_idx" ON "other_income" USING btree ("chemical_id");--> statement-breakpoint
CREATE INDEX "other_income_packaging_idx" ON "other_income" USING btree ("packaging_material_id");--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_one_material" CHECK (("other_income"."chemical_id" IS NOT NULL) <> ("other_income"."packaging_material_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_whole_quantity" CHECK ("other_income"."quantity" = trunc("other_income"."quantity"));--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_container_size" CHECK ("other_income"."container_size" > 0);--> statement-breakpoint
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_by_product_container" CHECK ((
      ("purchase_records"."by_product_tracked" = false AND "purchase_records"."container_name" IS NULL AND "purchase_records"."container_size" IS NULL)
      OR
      ("purchase_records"."by_product_tracked" = true AND "purchase_records"."container_name" IS NOT NULL AND length(btrim("purchase_records"."container_name")) BETWEEN 1 AND 40
        AND "purchase_records"."container_size" > 0 AND mod("purchase_records"."quantity", "purchase_records"."container_size") = 0)
    ));