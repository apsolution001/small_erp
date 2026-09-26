CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"email" "citext" NOT NULL,
	"role_id" uuid,
	"all_branches" boolean DEFAULT true NOT NULL,
	"branch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app_current_user(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invitations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_email_normalised" CHECK ("invitations"."email"::text = lower(btrim("invitations"."email"::text))),
	CONSTRAINT "invitations_token_hash_format" CHECK ("invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invitations_branch_scope" CHECK ("invitations"."all_branches" = (cardinality("invitations"."branch_ids") = 0)),
	CONSTRAINT "invitations_closed_once" CHECK ("invitations"."accepted_at" is null or "invitations"."revoked_at" is null),
	CONSTRAINT "invitations_role_while_pending" CHECK ("invitations"."role_id" is not null or "invitations"."accepted_at" is not null or "invitations"."revoked_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app_current_tenant() NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	"request_id" text DEFAULT app_current_request(),
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "outbox_topic_valid" CHECK ("outbox"."topic" in ('email.user_invitation')),
	CONSTRAINT "outbox_attempts_non_negative" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_pending_per_email" ON "invitations" USING btree ("tenant_id","email") WHERE "invitations"."accepted_at" is null and "invitations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "invitations_tenant_role_idx" ON "invitations" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "invitations_tenant_created_idx" ON "invitations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE "outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_tenant_idx" ON "outbox" USING btree ("tenant_id");