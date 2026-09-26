CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"party_type" text NOT NULL,
	"gst_registration_type" text NOT NULL,
	"gstin" char(15),
	"pan" char(10),
	"credit_limit" bigint,
	"credit_days" integer,
	"payment_terms" text,
	"contact_person" text,
	"email" text,
	"phone" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "parties_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "parties_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "parties_code_length" CHECK (char_length("parties"."code") between 1 and 30),
	CONSTRAINT "parties_name_length" CHECK (char_length("parties"."name") between 1 and 200),
	CONSTRAINT "parties_party_type_valid" CHECK ("parties"."party_type" in ('customer', 'vendor', 'both')),
	CONSTRAINT "parties_gst_registration_type_valid" CHECK ("parties"."gst_registration_type" in ('regular', 'composition', 'unregistered', 'consumer', 'overseas', 'sez')),
	CONSTRAINT "parties_gstin_format" CHECK ("parties"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "parties_gstin_by_registration" CHECK (("parties"."gst_registration_type" in ('regular', 'composition', 'sez')) = ("parties"."gstin" is not null)),
	CONSTRAINT "parties_pan_format" CHECK ("parties"."pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
	CONSTRAINT "parties_pan_matches_gstin" CHECK (substr("parties"."gstin", 3, 10) = "parties"."pan"),
	CONSTRAINT "parties_credit_limit_non_negative" CHECK ("parties"."credit_limit" >= 0),
	CONSTRAINT "parties_credit_days_range" CHECK ("parties"."credit_days" between 0 and 999),
	CONSTRAINT "parties_payment_terms_length" CHECK (char_length("parties"."payment_terms") between 1 and 200),
	CONSTRAINT "parties_contact_person_length" CHECK (char_length("parties"."contact_person") between 1 and 120),
	CONSTRAINT "parties_notes_length" CHECK (char_length("parties"."notes") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "party_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"state_code" char(2),
	"pincode" text,
	"country" char(2) DEFAULT 'IN' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "party_addresses_kind_valid" CHECK ("party_addresses"."kind" in ('billing', 'shipping')),
	CONSTRAINT "party_addresses_label_length" CHECK (char_length("party_addresses"."label") between 1 and 50),
	CONSTRAINT "party_addresses_line1_length" CHECK (char_length("party_addresses"."line1") between 1 and 200),
	CONSTRAINT "party_addresses_line2_length" CHECK (char_length("party_addresses"."line2") between 1 and 200),
	CONSTRAINT "party_addresses_city_length" CHECK (char_length("party_addresses"."city") between 1 and 100),
	CONSTRAINT "party_addresses_country_format" CHECK ("party_addresses"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "party_addresses_state_code_format" CHECK ("party_addresses"."state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "party_addresses_indian_or_foreign" CHECK (("party_addresses"."country" = 'IN' and "party_addresses"."state_code" is not null and "party_addresses"."pincode" is not null and "party_addresses"."pincode" ~ '^[1-9][0-9]{5}$')
        or ("party_addresses"."country" <> 'IN' and "party_addresses"."state_code" is null and coalesce(char_length("party_addresses"."pincode"), 0) <= 10))
);
--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_tenant_name_idx" ON "parties" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "parties_tenant_gstin_idx" ON "parties" USING btree ("tenant_id","gstin");--> statement-breakpoint
CREATE INDEX "party_addresses_tenant_party_idx" ON "party_addresses" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_addresses_one_default_per_kind" ON "party_addresses" USING btree ("tenant_id","party_id","kind") WHERE "party_addresses"."is_default";