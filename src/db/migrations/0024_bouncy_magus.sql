CREATE TABLE "production_loss_limits" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"batch" numeric(4, 1) DEFAULT '10.0' NOT NULL,
	"chemical" numeric(4, 1) DEFAULT '10.0' NOT NULL,
	"powder" numeric(4, 1) DEFAULT '10.0' NOT NULL,
	"shopper" numeric(4, 1) DEFAULT '10.0' NOT NULL,
	"other_packing" numeric(4, 1) DEFAULT '10.0' NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_loss_limits" ADD CONSTRAINT "production_loss_limits_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;