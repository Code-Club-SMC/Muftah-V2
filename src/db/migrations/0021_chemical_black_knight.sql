ALTER TABLE "sales_returns" ADD COLUMN "price_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "price_override_reason" text;