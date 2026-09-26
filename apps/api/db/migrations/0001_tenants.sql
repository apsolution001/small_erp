CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"plan" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("tenants"."slug") <= 63),
	CONSTRAINT "tenants_status_valid" CHECK ("tenants"."status" in ('trial', 'active', 'suspended', 'closed')),
	CONSTRAINT "tenants_plan_valid" CHECK ("tenants"."plan" in ('starter', 'growth', 'pro')),
	CONSTRAINT "tenants_trial_has_end" CHECK ("tenants"."status" <> 'trial' or "tenants"."trial_ends_at" is not null)
);
