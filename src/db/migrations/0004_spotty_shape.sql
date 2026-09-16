CREATE TABLE "driver_trips" (
	"id" text PRIMARY KEY NOT NULL,
	"driver_id" text NOT NULL,
	"trip_date" timestamp NOT NULL,
	"destination" text NOT NULL,
	"vehicle_number" text,
	"distance_km" numeric(8, 2) DEFAULT '0' NOT NULL,
	"rate_per_km" numeric(8, 2) NOT NULL,
	"tada_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"recorded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"license_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"employee_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_driver" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_trips" ADD CONSTRAINT "driver_trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_trips" ADD CONSTRAINT "driver_trips_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;