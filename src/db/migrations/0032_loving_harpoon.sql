CREATE TABLE "returned_stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"condition" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"units_before" integer NOT NULL,
	"value_before" numeric(14, 2) NOT NULL,
	"value_removed" numeric(14, 2) NOT NULL,
	"unit_price" numeric(12, 2),
	"sale_amount" numeric(14, 2),
	"loss_amount" numeric(14, 2) NOT NULL,
	"wallet_id" text,
	"transaction_id" text,
	"note" text,
	"movement_date" timestamp DEFAULT now() NOT NULL,
	"performed_by_id" text NOT NULL,
	"voided_at" timestamp,
	"voided_by_id" text,
	"void_reason" text,
	"void_transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "returned_stock_movements_kind" CHECK ("returned_stock_movements"."kind" in ('scrap', 'seconds_sale', 'revalue'))
);
--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "damaged_salvage_per_unit" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "expired_salvage_per_unit" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN "write_off_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_stock_traces" ADD COLUMN "write_off_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "returned_stock_movements" ADD CONSTRAINT "returned_stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returned_stock_movements" ADD CONSTRAINT "returned_stock_movements_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returned_stock_movements" ADD CONSTRAINT "returned_stock_movements_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returned_stock_movements" ADD CONSTRAINT "returned_stock_movements_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returned_stock_movements" ADD CONSTRAINT "returned_stock_movements_performed_by_id_user_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returned_stock_movements" ADD CONSTRAINT "returned_stock_movements_voided_by_id_user_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returned_stock_movements" ADD CONSTRAINT "returned_stock_movements_void_transaction_id_transactions_id_fk" FOREIGN KEY ("void_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_returned_stock_movements_date" ON "returned_stock_movements" USING btree ("movement_date");--> statement-breakpoint
CREATE INDEX "idx_returned_stock_movements_stock" ON "returned_stock_movements" USING btree ("warehouse_id","recipe_id","condition");