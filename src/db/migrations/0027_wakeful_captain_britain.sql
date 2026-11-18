CREATE TABLE "other_income" (
	"id" text PRIMARY KEY NOT NULL,
	"income_date" timestamp NOT NULL,
	"item_name" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"wallet_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"performed_by_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_id" text,
	"void_reason" text,
	"void_transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "other_income_positive" CHECK ("other_income"."amount" > 0 and "other_income"."quantity" > 0 and "other_income"."unit_price" > 0)
);
--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_performed_by_id_user_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_voided_by_id_user_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_income" ADD CONSTRAINT "other_income_void_transaction_id_transactions_id_fk" FOREIGN KEY ("void_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "other_income_date_idx" ON "other_income" USING btree ("income_date");