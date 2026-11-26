CREATE TABLE "expense_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category_id" text NOT NULL,
	"amount" numeric(12, 2),
	"payee" text,
	"wallet_id" text,
	"note" text,
	"reminder_day" integer,
	"skipped_month" text,
	"archived_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_templates_reminder_day_check" CHECK ("expense_templates"."reminder_day" is null or "expense_templates"."reminder_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "expense_templates" ADD CONSTRAINT "expense_templates_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_templates" ADD CONSTRAINT "expense_templates_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_templates" ADD CONSTRAINT "expense_templates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_templates_active_idx" ON "expense_templates" USING btree ("archived_at","name");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_template_id_expense_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."expense_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_template_date_idx" ON "expenses" USING btree ("template_id","expense_date");