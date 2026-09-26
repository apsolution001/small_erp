CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "sessions_revoked_reason_valid" CHECK ("sessions"."revoked_reason" in ('logout', 'reuse_detected', 'switched', 'access_revoked')),
	CONSTRAINT "sessions_revocation_complete" CHECK (("sessions"."revoked_at" is null) = ("sessions"."revoked_reason" is null)),
	CONSTRAINT "sessions_absolute_after_created" CHECK ("sessions"."absolute_expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_id_user_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_user_fk" FOREIGN KEY ("membership_id","user_id") REFERENCES "public"."memberships"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_membership_idx" ON "sessions" USING btree ("membership_id");--> statement-breakpoint
-- Hand-written: one session per existing token family, before the family FK is added. The owner
-- is subject to FORCE RLS on refresh_tokens, so it is lifted for the backfill only. Families
-- whose tokens are all revoked become revoked sessions (with the family's revocation reason).
ALTER TABLE "refresh_tokens" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "sessions" ("id", "user_id", "membership_id", "created_at", "absolute_expires_at", "revoked_at", "revoked_reason")
SELECT
	"family_id",
	(array_agg("user_id" ORDER BY "created_at", "id"))[1],
	(array_agg("membership_id" ORDER BY "created_at", "id"))[1],
	min("created_at"),
	min("created_at") + interval '30 days',
	CASE WHEN bool_and("revoked_at" IS NOT NULL) THEN max("revoked_at") END,
	CASE WHEN bool_and("revoked_at" IS NOT NULL) THEN coalesce(
		(array_agg("revoked_reason" ORDER BY "revoked_at" DESC) FILTER (WHERE "revoked_reason" <> 'rotated'))[1],
		'logout'
	) END
FROM "refresh_tokens"
GROUP BY "family_id";--> statement-breakpoint
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_family_id_sessions_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."refresh_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_replaced_by_idx" ON "refresh_tokens" USING btree ("replaced_by_id");--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_membership_id_memberships_id_fk";--> statement-breakpoint
DROP INDEX "refresh_tokens_user_idx";--> statement-breakpoint
DROP INDEX "refresh_tokens_membership_idx";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP COLUMN "membership_id";--> statement-breakpoint
-- Login lockout state moved to Redis (keyed by the email's hash, ADR 0016).
ALTER TABLE "users" DROP CONSTRAINT "users_failed_login_count_non_negative";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "failed_login_count";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "locked_until";
