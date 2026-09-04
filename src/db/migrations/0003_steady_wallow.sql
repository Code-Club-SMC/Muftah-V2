ALTER TYPE "public"."leave_type" ADD VALUE 'compensatory';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "overtime_compensation_method" text DEFAULT 'payout';--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "compensatory_hours_used" numeric(5, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "compensatory_hours_balance" numeric(6, 2) DEFAULT '0';