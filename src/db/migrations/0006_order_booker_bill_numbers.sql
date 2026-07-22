ALTER TABLE "orders" ALTER COLUMN "bill_number" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "bill_number" SET DATA TYPE integer;--> statement-breakpoint
DROP SEQUENCE IF EXISTS "orders_bill_number_seq";--> statement-breakpoint
WITH ranked_orders AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "order_booker_id"
			ORDER BY "created_at", "id"
		) AS next_bill_number
	FROM "orders"
)
UPDATE "orders" AS o
SET "bill_number" = ranked_orders.next_bill_number
FROM ranked_orders
WHERE ranked_orders."id" = o."id";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "uq_orders_order_booker_bill_number" UNIQUE("order_booker_id","bill_number");
