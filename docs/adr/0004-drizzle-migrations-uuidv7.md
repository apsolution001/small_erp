# 0004 — Drizzle ORM, SQL-first migrations, UUIDv7 keys

**Status:** Accepted · 2026-09-26

## Decision
- Drizzle table definitions live next to each module (`*.schema.ts`) and are aggregated in `src/infra/db/schema.ts`.
- `drizzle-kit generate` produces SQL migrations committed in `apps/api/db/migrations`. RLS helpers, triggers, functions and grants are custom SQL migrations. The migration runner uses `ekaro_owner`.
- Migrations are forward-only and never edited after merge.
- Primary keys are **UUIDv7**, generated in the app (`@ekaro/core/id`). They are globally unique across tenants, which makes import and merge safe, and time-ordered, which keeps B-tree locality good. They do not expose counts the way serial IDs do.
- Human-facing identifiers (document numbers, item codes) are separate business keys.

## Consequences
- Queries stay close to SQL, and complex reports can use raw `sql` templates, which are still parameterised.
- Reviewers read the SQL diff of every migration.
