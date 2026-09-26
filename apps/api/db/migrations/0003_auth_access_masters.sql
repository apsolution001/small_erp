CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"mobile" text,
	"full_name" text NOT NULL,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"totp_secret_enc" text,
	"status" text DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_normalised" CHECK ("users"."email"::text = lower(btrim("users"."email"::text))),
	CONSTRAINT "users_mobile_format" CHECK ("users"."mobile" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "users_full_name_length" CHECK (char_length("users"."full_name") between 1 and 120),
	CONSTRAINT "users_password_hash_bcrypt" CHECK ("users"."password_hash" ~ '^\$2[aby]\$[0-9]{2}\$'),
	CONSTRAINT "users_status_valid" CHECK ("users"."status" in ('active', 'disabled')),
	CONSTRAINT "users_failed_login_count_non_negative" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"replaced_by_id" uuid,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_tokens_hash_format" CHECK ("refresh_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refresh_tokens_revoked_reason_valid" CHECK ("refresh_tokens"."revoked_reason" in ('rotated', 'logout', 'reuse_detected', 'switched', 'access_revoked')),
	CONSTRAINT "refresh_tokens_revocation_complete" CHECK (("refresh_tokens"."revoked_at" is null) = ("refresh_tokens"."revoked_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"is_billable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "roles_name_length" CHECK (char_length("roles"."name") between 1 and 50),
	CONSTRAINT "roles_description_length" CHECK (char_length("roles"."description") between 1 and 200),
	CONSTRAINT "roles_owner_is_system" CHECK (not "roles"."is_owner" or "roles"."is_system"),
	CONSTRAINT "roles_owner_stores_no_permissions" CHECK (not "roles"."is_owner" or cardinality("roles"."permissions") = 0)
);
--> statement-breakpoint
CREATE TABLE "membership_branches" (
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "membership_branches_pkey" PRIMARY KEY("membership_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"all_branches" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memberships_tenant_user_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "memberships_status_valid" CHECK ("memberships"."status" in ('invited', 'active', 'disabled')),
	CONSTRAINT "memberships_joined_when_active" CHECK ("memberships"."status" <> 'active' or "memberships"."joined_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "company_profile" (
	"tenant_id" uuid PRIMARY KEY DEFAULT app_current_tenant() NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"gstin" char(15),
	"pan" char(10),
	"state_code" char(2) NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"pincode" char(6) NOT NULL,
	"email" text,
	"phone" text,
	"logo_object_key" text,
	"books_begin_date" date NOT NULL,
	"valuation_method" text DEFAULT 'weighted_average' NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"round_off_sales" boolean DEFAULT true NOT NULL,
	"hsn_min_digits" smallint DEFAULT 4 NOT NULL,
	"e_invoice_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "company_profile_legal_name_length" CHECK (char_length("company_profile"."legal_name") between 1 and 200),
	CONSTRAINT "company_profile_trade_name_length" CHECK (char_length("company_profile"."trade_name") between 1 and 200),
	CONSTRAINT "company_profile_gstin_format" CHECK ("company_profile"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "company_profile_gstin_state" CHECK (left("company_profile"."gstin", 2) = "company_profile"."state_code"),
	CONSTRAINT "company_profile_pan_format" CHECK ("company_profile"."pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
	CONSTRAINT "company_profile_pan_matches_gstin" CHECK (substr("company_profile"."gstin", 3, 10) = "company_profile"."pan"),
	CONSTRAINT "company_profile_state_code_format" CHECK ("company_profile"."state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "company_profile_pincode_format" CHECK ("company_profile"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "company_profile_valuation_method_valid" CHECK ("company_profile"."valuation_method" in ('fifo', 'weighted_average')),
	CONSTRAINT "company_profile_hsn_min_digits_valid" CHECK ("company_profile"."hsn_min_digits" in (4, 6))
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"gstin" char(15),
	"state_code" char(2) NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"pincode" char(6) NOT NULL,
	"is_head_office" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "branches_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "branches_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "branches_code_length" CHECK (char_length("branches"."code") between 1 and 10),
	CONSTRAINT "branches_name_length" CHECK (char_length("branches"."name") between 1 and 100),
	CONSTRAINT "branches_gstin_format" CHECK ("branches"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "branches_gstin_state" CHECK (left("branches"."gstin", 2) = "branches"."state_code"),
	CONSTRAINT "branches_state_code_format" CHECK ("branches"."state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "branches_pincode_format" CHECK ("branches"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "branches_head_office_active" CHECK (not "branches"."is_head_office" or "branches"."is_active")
);
--> statement-breakpoint
CREATE TABLE "godowns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "godowns_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "godowns_code_length" CHECK (char_length("godowns"."code") between 1 and 10),
	CONSTRAINT "godowns_name_length" CHECK (char_length("godowns"."name") between 1 and 100),
	CONSTRAINT "godowns_address_length" CHECK (char_length("godowns"."address") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"uqc" text NOT NULL,
	"decimal_places" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "units_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "units_code_format" CHECK ("units"."code" ~ '^[A-Z0-9][A-Z0-9-]{0,9}$'),
	CONSTRAINT "units_name_length" CHECK (char_length("units"."name") between 1 and 50),
	CONSTRAINT "units_uqc_valid" CHECK ("units"."uqc" in ('BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NA', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS')),
	CONSTRAINT "units_decimal_places_range" CHECK ("units"."decimal_places" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"name" text NOT NULL,
	"gst_rate" numeric(7, 4) NOT NULL,
	"cess_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"is_exempt" boolean DEFAULT false NOT NULL,
	"is_nil_rated" boolean DEFAULT false NOT NULL,
	"is_non_gst" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tax_rates_tenant_slab_unique" UNIQUE("tenant_id","gst_rate","cess_rate","is_exempt","is_nil_rated","is_non_gst"),
	CONSTRAINT "tax_rates_name_length" CHECK (char_length("tax_rates"."name") between 1 and 50),
	CONSTRAINT "tax_rates_gst_rate_range" CHECK ("tax_rates"."gst_rate" between 0 and 100),
	CONSTRAINT "tax_rates_cess_rate_non_negative" CHECK ("tax_rates"."cess_rate" >= 0),
	CONSTRAINT "tax_rates_one_special_kind" CHECK ("tax_rates"."is_exempt"::int + "tax_rates"."is_nil_rated"::int + "tax_rates"."is_non_gst"::int <= 1),
	CONSTRAINT "tax_rates_special_kind_untaxed" CHECK (not ("tax_rates"."is_exempt" or "tax_rates"."is_nil_rated" or "tax_rates"."is_non_gst") or ("tax_rates"."gst_rate" = 0 and "tax_rates"."cess_rate" = 0))
);
--> statement-breakpoint
CREATE TABLE "document_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"padding" smallint DEFAULT 4 NOT NULL,
	"next_number" bigint DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_series_tenant_key_unique" UNIQUE("tenant_id","branch_id","doc_type","fy","prefix","suffix"),
	CONSTRAINT "document_series_doc_type_valid" CHECK ("document_series"."doc_type" in ('purchase_requisition', 'purchase_order', 'grn', 'purchase_invoice', 'debit_note', 'quotation', 'sales_order', 'delivery_challan', 'sales_invoice', 'credit_note', 'stock_transfer', 'stock_adjustment', 'work_order', 'material_issue', 'production_entry', 'job_work_out', 'job_work_in', 'payment', 'receipt', 'contra', 'journal')),
	CONSTRAINT "document_series_fy_format" CHECK ("document_series"."fy" ~ '^[0-9]{4}-[0-9]{2}$' and right("document_series"."fy", 2)::int = (left("document_series"."fy", 4)::int + 1) % 100),
	CONSTRAINT "document_series_affix_format" CHECK ("document_series"."prefix" ~ '^([A-Z1-9][A-Z0-9/-]{0,9})?$' and "document_series"."suffix" ~ '^[A-Z0-9/-]{0,6}$'),
	CONSTRAINT "document_series_padding_range" CHECK ("document_series"."padding" between 1 and 8),
	CONSTRAINT "document_series_next_number_positive" CHECK ("document_series"."next_number" >= 1),
	CONSTRAINT "document_series_number_length" CHECK (char_length("document_series"."prefix") + greatest("document_series"."padding", char_length("document_series"."next_number"::text)) + char_length("document_series"."suffix") <= 16)
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "godowns" ADD CONSTRAINT "godowns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "godowns" ADD CONSTRAINT "godowns_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_membership_idx" ON "refresh_tokens" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_name_unique" ON "roles" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "roles_one_owner" ON "roles" USING btree ("tenant_id") WHERE "roles"."is_owner";--> statement-breakpoint
CREATE INDEX "membership_branches_tenant_branch_idx" ON "membership_branches" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_role_idx" ON "memberships" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "memberships_invited_by_idx" ON "memberships" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_one_head_office" ON "branches" USING btree ("tenant_id") WHERE "branches"."is_head_office";--> statement-breakpoint
CREATE INDEX "godowns_tenant_branch_idx" ON "godowns" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_series_one_default" ON "document_series" USING btree ("tenant_id","branch_id","doc_type","fy") WHERE "document_series"."is_default";--> statement-breakpoint
CREATE INDEX "document_series_tenant_branch_idx" ON "document_series" USING btree ("tenant_id","branch_id");