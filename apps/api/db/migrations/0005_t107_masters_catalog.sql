ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "item_categories_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "item_categories_name_length" CHECK (char_length("item_categories"."name") between 1 and 100),
	CONSTRAINT "item_categories_not_own_parent" CHECK ("item_categories"."parent_id" <> "item_categories"."id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"item_type" text NOT NULL,
	"item_kind" text NOT NULL,
	"category_id" uuid,
	"hsn_sac" text NOT NULL,
	"base_unit_id" uuid NOT NULL,
	"purchase_unit_id" uuid,
	"sales_unit_id" uuid,
	"reorder_level" numeric(20, 6),
	"reorder_qty" numeric(20, 6),
	"min_order_qty" numeric(20, 6),
	"track_batches" boolean DEFAULT false NOT NULL,
	"track_expiry" boolean DEFAULT false NOT NULL,
	"standard_purchase_rate" numeric(20, 6),
	"standard_sales_rate" numeric(20, 6),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "items_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "items_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "items_code_length" CHECK (char_length("items"."code") between 1 and 30),
	CONSTRAINT "items_name_length" CHECK (char_length("items"."name") between 1 and 200),
	CONSTRAINT "items_description_length" CHECK (char_length("items"."description") between 1 and 1000),
	CONSTRAINT "items_item_type_valid" CHECK ("items"."item_type" in ('goods', 'service')),
	CONSTRAINT "items_item_kind_valid" CHECK ("items"."item_kind" in ('raw_material', 'semi_finished', 'finished_good', 'trading', 'consumable', 'scrap', 'service')),
	CONSTRAINT "items_service_kind" CHECK (("items"."item_type" = 'service') = ("items"."item_kind" = 'service')),
	CONSTRAINT "items_hsn_sac_format" CHECK (("items"."item_type" = 'goods' and "items"."hsn_sac" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$')
        or ("items"."item_type" = 'service' and "items"."hsn_sac" ~ '^99[0-9]{4}$')),
	CONSTRAINT "items_expiry_needs_batches" CHECK (not "items"."track_expiry" or "items"."track_batches"),
	CONSTRAINT "items_service_no_batches" CHECK ("items"."item_type" <> 'service' or not "items"."track_batches"),
	CONSTRAINT "items_quantities_non_negative" CHECK ("items"."reorder_level" >= 0 and "items"."reorder_qty" >= 0 and "items"."min_order_qty" >= 0),
	CONSTRAINT "items_rates_non_negative" CHECK ("items"."standard_purchase_rate" >= 0 and "items"."standard_sales_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "item_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"factor_to_base" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "item_units_item_unit_unique" UNIQUE("tenant_id","item_id","unit_id"),
	CONSTRAINT "item_units_factor_positive" CHECK ("item_units"."factor_to_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "item_tax_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"item_id" uuid NOT NULL,
	"tax_rate_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "item_tax_rates_item_effective_unique" UNIQUE("tenant_id","item_id","effective_from")
);
--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."item_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."item_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_base_unit_fk" FOREIGN KEY ("tenant_id","base_unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_unit_fk" FOREIGN KEY ("tenant_id","purchase_unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sales_unit_fk" FOREIGN KEY ("tenant_id","sales_unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tax_rates" ADD CONSTRAINT "item_tax_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tax_rates" ADD CONSTRAINT "item_tax_rates_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tax_rates" ADD CONSTRAINT "item_tax_rates_tax_rate_fk" FOREIGN KEY ("tenant_id","tax_rate_id") REFERENCES "public"."tax_rates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_name_per_parent" ON "item_categories" USING btree ("tenant_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "item_categories_tenant_parent_idx" ON "item_categories" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "items_tenant_category_idx" ON "items" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "items_tenant_base_unit_idx" ON "items" USING btree ("tenant_id","base_unit_id");--> statement-breakpoint
CREATE INDEX "items_tenant_purchase_unit_idx" ON "items" USING btree ("tenant_id","purchase_unit_id");--> statement-breakpoint
CREATE INDEX "items_tenant_sales_unit_idx" ON "items" USING btree ("tenant_id","sales_unit_id");--> statement-breakpoint
CREATE INDEX "items_tenant_name_idx" ON "items" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "items_tenant_hsn_sac_idx" ON "items" USING btree ("tenant_id","hsn_sac");--> statement-breakpoint
CREATE INDEX "item_units_tenant_unit_idx" ON "item_units" USING btree ("tenant_id","unit_id");--> statement-breakpoint
CREATE INDEX "item_tax_rates_tenant_tax_rate_idx" ON "item_tax_rates" USING btree ("tenant_id","tax_rate_id");
