CREATE TABLE "entity_recipe_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"price_per_carton" numeric(12, 2) NOT NULL,
	"updated_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_entity_recipe_rates_entity_recipe" UNIQUE("entity_type","entity_id","recipe_id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "order_booker_id" text;--> statement-breakpoint
ALTER TABLE "entity_recipe_rates" ADD CONSTRAINT "entity_recipe_rates_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_recipe_rates" ADD CONSTRAINT "entity_recipe_rates_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entity_recipe_rates_entity" ON "entity_recipe_rates" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_booker_id_order_bookers_id_fk" FOREIGN KEY ("order_booker_id") REFERENCES "public"."order_bookers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoices_order_booker" ON "invoices" USING btree ("order_booker_id");