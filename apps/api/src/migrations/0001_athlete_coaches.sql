CREATE TABLE "athlete_coaches" (
	"organization_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"athlete_role" text DEFAULT 'athlete' NOT NULL,
	"coach_id" uuid NOT NULL,
	"coach_role" text DEFAULT 'coach' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_coaches_organization_id_athlete_id_coach_id_pk" PRIMARY KEY("organization_id","athlete_id","coach_id"),
	CONSTRAINT "athlete_coaches_athlete_role_check" CHECK ("athlete_coaches"."athlete_role" = 'athlete'),
	CONSTRAINT "athlete_coaches_coach_role_check" CHECK ("athlete_coaches"."coach_role" = 'coach')
);
--> statement-breakpoint
ALTER TABLE "athlete_coaches" ADD CONSTRAINT "athlete_coaches_athlete_role_fk" FOREIGN KEY ("organization_id","athlete_id","athlete_role") REFERENCES "public"."organization_membership_roles"("organization_id","account_id","role") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_coaches" ADD CONSTRAINT "athlete_coaches_coach_role_fk" FOREIGN KEY ("organization_id","coach_id","coach_role") REFERENCES "public"."organization_membership_roles"("organization_id","account_id","role") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athlete_coaches_coach" ON "athlete_coaches" USING btree ("organization_id","coach_id");