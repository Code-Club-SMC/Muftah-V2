CREATE TABLE "commission_earnings" (
	"id" text PRIMARY KEY NOT NULL,
	"order_booker_id" text NOT NULL,
	"order_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"payment_id" text,
	"sales_return_id" text,
	"kind" text NOT NULL,
	"bearer" text,
	"base_amount" numeric(12, 2) NOT NULL,
	"rate" numeric(7, 4) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"entry_date" timestamp with time zone NOT NULL,
	"paid_in_payslip_id" text,
	"created_by_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_mode" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_rate_locked" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "commission_earnings" ADD CONSTRAINT "commission_earnings_order_booker_id_order_bookers_id_fk" FOREIGN KEY ("order_booker_id") REFERENCES "public"."order_bookers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_earnings" ADD CONSTRAINT "commission_earnings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_earnings" ADD CONSTRAINT "commission_earnings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_earnings" ADD CONSTRAINT "commission_earnings_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_earnings" ADD CONSTRAINT "commission_earnings_sales_return_id_sales_returns_id_fk" FOREIGN KEY ("sales_return_id") REFERENCES "public"."sales_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_earnings" ADD CONSTRAINT "commission_earnings_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_earnings_payment_kind_unique" ON "commission_earnings" USING btree ("payment_id","kind") WHERE "commission_earnings"."payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_earnings_return_kind_unique" ON "commission_earnings" USING btree ("sales_return_id","kind") WHERE "commission_earnings"."sales_return_id" is not null;--> statement-breakpoint
CREATE INDEX "commission_earnings_booker_date_idx" ON "commission_earnings" USING btree ("order_booker_id","entry_date");--> statement-breakpoint
CREATE INDEX "commission_earnings_invoice_idx" ON "commission_earnings" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "commission_earnings_unpaid_idx" ON "commission_earnings" USING btree ("order_booker_id") WHERE "commission_earnings"."paid_in_payslip_id" is null;