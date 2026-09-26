# 0003 — Multi-tenancy: shared schema + Postgres RLS

**Status:** Accepted · 2026-09-26

## Context

BRD §10/§11: tenant isolation must be enforced _in the database_. The plan is cheap per-tenant cost and 1,000 tenants without redesign. BRD §16 rates a cross-tenant breach as "very high" impact.

## Decision

- Use a shared schema where every tenant-owned table has `tenant_id`, and RLS is **enabled and forced** with policy `tenant_id = app_current_tenant()`.
- `app_current_tenant()` reads `current_setting('app.tenant_id', true)`. When unset it returns NULL, so queries return no rows and inserts fail the `with check` (fail closed).
- The API connects as **`ekaro_app`** (no BYPASSRLS, not an owner). Every authenticated request runs inside a transaction that begins with `set_config('app.tenant_id', $tid, true)`, `app.user_id` and `app.request_id`. They are transaction-local, so a pooled connection can never leak context.
- **Platform tables** (`tenants`, `users`, `memberships`, `refresh_tokens`, `roles`...) are needed before a tenant is known (login, tenant switch). They are accessed through a separate `ekaro_platform` connection that only `modules/platform` and `modules/auth` may import (lint-enforced). `ekaro_platform` has **no BYPASSRLS**, which also keeps it portable to managed Postgres. `memberships`, `roles` and `company_profile` carry `tenant_id` with the normal tenant policy, plus a read-only policy `platform_read` granted **only to `ekaro_platform`** so that login can list a user's tenants. Signup bootstrap runs on the platform connection and sets `app.tenant_id` to the new tenant within its transaction, so every seed insert passes the ordinary `with check`.
- A SQL helper `app_enable_tenant_table(regclass)` applies enable, force, policy, grants and the audit trigger in one call, so no table forgets a step.
- CI runs isolation tests for every tenant table.

## Consequences

- A missing `WHERE tenant_id` in code cannot leak data.
- The small per-transaction overhead of `set_config` is acceptable.
- Reports that span tenants (platform admin) go through the platform connection with explicit audited access.
