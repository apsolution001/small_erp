---
id: T-103
title: 'API foundation: config, logging, errors, DB roles, RLS helpers, audit trigger, tx context, test harness'
status: done
sprint: 1
area: server
depends_on: [T-003]
spec: docs/standards/backend.md, docs/standards/database.md, docs/adr/0003-multi-tenancy-rls.md, docs/adr/0008-audit-trigger.md
---

## Scope

- `src/config/env.ts` (Zod-validated env: DATABASE_URL_APP, DATABASE_URL_PLATFORM, DATABASE_URL_OWNER, REDIS_URL, JWT__, APP_ORIGIN, GSP_PROVIDER, SMTP__, ...).
- Pino logger with redaction and a request id. Helmet, CORS and a global prefix `/api/v1`.
- `common/errors` (`DomainError` hierarchy + `ProblemDetailsFilter`), `common/zod-validation.pipe.ts`, and the `@Public()` and `@RequirePermission()` decorators (the guard implementation lands in T-104).
- `infra/db`: two Drizzle clients (`app` pool as ekaro_app, `platform` pool as ekaro_platform), `columns.ts` with the `tenantTable()` helper (id uuidv7, tenant_id, created/updated at/by, version), `schema.ts` aggregator, drizzle.config and the migrate script (as ekaro_owner).
- Base SQL migration: extensions (citext, pgcrypto), `app_current_tenant()`, `app_current_user()`, the `audit_log` table partitioned by month (with a function that creates future partitions), `audit_row_change()`, `app_enable_tenant_table(regclass)` (enable + force RLS, policy, grants to ekaro_app, audit trigger), and the `tenants` platform table.
- CLS + `@nestjs-cls/transactional` with the Drizzle adapter. `TenantTxInterceptor` sets `app.tenant_id`, `app.user_id` and `app.request_id` via `set_config(..., true)`. `runInTenant()` for jobs.
- Health endpoint (`/api/v1/health`: db + redis) via terminus.
- Test harness: vitest e2e config, a global setup that migrates `ekaro_test`, an app factory, factories to create tenants and users, and an `asTenant(tenantId)` raw-SQL helper that connects as ekaro_app for RLS tests.

## Acceptance criteria

- An e2e test proves that a dummy RLS test table (created only in the test) returns 0 rows without context, only its own rows with context, and that the insert with check blocks a foreign tenant_id. The audit trigger writes old and new values.
- Invalid env makes boot fail with a clear message.

## Decisions

Architectural decisions are recorded in [ADR 0014](../adr/0014-tenant-context-plumbing.md). In short:

1. **The DB fills the context columns.** `tenantTable()` defaults `tenant_id` to `app_current_tenant()` and `created_by`/`updated_by` to `app_current_user()`. Drizzle re-stamps `updated_at`/`updated_by` on update. Repositories never pass the tenant, and RLS `with check` still rejects a foreign one. The `id` is a UUIDv7 generated in the app (`$defaultFn(uuidv7)`).
2. **Request transactions.** The global `TenantTxInterceptor` wraps a request only when CLS holds a `tenantId` (the T-104 JWT guard sets it). Public and platform routes run without a tenant transaction. `TenantContext.runInTenant()` always opens a new CLS context and a new transaction (`RequiresNew`), so a job never joins or re-tenants an outer transaction.
3. **`tenants` has RLS too.** `ekaro_platform` has full access (select/insert/update, no delete: tenants are closed by status). `ekaro_app` reads only its own row. This is narrower than the plain "read to ekaro_app" in the brief, so the tenant list is never exposed to tenant code.
4. **`audit_log`:**
   - PK `(id, changed_at)`, with `id` a UUIDv7 made in SQL (`app_uuidv7()`), since a partitioned PK must contain the partition key.
   - `row_id` is nullable (composite-key link tables have no `id`). No FK to `tenants`.
   - Monthly UTC partitions. `app_ensure_audit_partitions(months_ahead)` is SECURITY DEFINER and executable by `ekaro_app` (the scheduled job). The migration creates the current month + 12, and a monthly worker job must keep calling it (see Follow-ups). There is no DEFAULT partition, deliberately.
   - The trigger is SECURITY INVOKER. It skips no-op updates by comparing `to_jsonb(old) = to_jsonb(new)`.
   - `ekaro_platform` also has INSERT on `audit_log`, because signup bootstrap writes tenant rows through it.
5. **Privileges are deny by default.** Functions created by `ekaro_owner` are not executable by PUBLIC. The context functions are granted to app/platform. `app_enable_tenant_table` and `app_grant_platform_read` are owner-only. `app_enable_tenant_table` refuses a table without `tenant_id uuid not null` and is idempotent.
6. **Problem details.** `type` is always `about:blank` (so `title` is the HTTP status phrase), `code` is the stable identifier, and `requestId` is an extension. `errors[]` entries are `{ path, message, code }`: a dotted path (`lines.0.qty`, `''` for the root) and Zod's issue code. A raw `ZodError` thrown anywhere also renders as 400, per the brief. A Postgres unique violation (23505, also when wrapped by Drizzle) renders as 409 `DUPLICATE_RECORD` without the constraint name. 5xx responses never include the message, and they are logged with the error.
7. **Request id.** An inbound `x-request-id` is kept when it matches `^[A-Za-z0-9._:=-]{1,128}$` (proxy trace ids); otherwise a UUIDv7 is generated. It is set once, by the first middleware. The same id flows to Pino (`requestId`), CLS, `app.request_id` (and so `audit_log.request_id`, which is `text`), the `x-request-id` response header and problem bodies.
8. **Env.**
   - `DATABASE_URL_OWNER` is optional for the API process (it never connects as owner). `loadMigrationEnv()` requires it for the migrator.
   - Missing variables are reported as `is required`. Values are never echoed.
   - In production, the example JWT secret is rejected.
   - `GSP_PROVIDER` accepts only `mock` until a real adapter exists.
9. **Tests use their own database.** The harness uses the normal URLs re-pointed at `TEST_DB_NAME` (default `ekaro_test`, must end in `_test`). `vitest.config.ts` loads the repo-root `.env`, and real env vars (CI) take precedence.
10. **CORS** uses an allow-list (`[APP_ORIGIN]`), so other origins get no `Access-Control-Allow-Origin`. Paths outside `/api/v1` get Express's plain 404, because Nest scopes its not-found handler to the global prefix.
11. **Library typing workaround.** `@nestjs-cls/transactional-adapter-drizzle-orm` declares `defaultTxOptions` in a way that breaks `TransactionHost` inference under `exactOptionalPropertyTypes`. `AppTxHost` is therefore typed through the plugin's `TransactionalAdapter<AppDb, AppDb, PgTransactionConfig>` interface (same types the adapter uses). There is no cast and no `any`.

## Plan

- [x] `src/config/env.ts` (+ spec), `env.module.ts` (`ENV` token), `bootstrap.ts`/`main.ts` (readable boot failure, shutdown hooks)
- [x] `src/common/errors` (DomainError hierarchy, `ProblemDetailsFilter`), `zod-validation.pipe.ts`, `decorators/{public,require-permission}.decorator.ts` (+ specs)
- [x] `src/infra/logging` (request id middleware, Pino options with redaction and CLS fields) (+ specs)
- [x] `src/infra/db`: `base-columns.ts`, `columns.ts` (`tenantTable()`), `casing.ts`, `schema.ts`, `app-db.ts`, `platform-db.ts`, `pg-pool.ts`, `db.module.ts`, `migrator.ts`, `migrate.ts`; `drizzle.config.ts`
- [x] Migrations `0000_foundation` (custom), `0001_tenants` (generated), `0002_tenancy_audit` (custom)
- [x] `src/infra/tenancy`: `RequestContext`, `TenantContext` (`inTenantTransaction`, `runInTenant`), `TenantTxInterceptor` (+ spec), `TenancyModule` (CLS + transactional plugin)
- [x] `src/infra/redis`, `src/infra/health` (terminus: db + redis) (+ spec); `app.module.ts`, `app.setup.ts`
- [x] Test harness: `test/support/{test-env,global-setup,setup-file,db,app}.ts`, `test/factories/tenants.ts`
- [x] e2e: `test/tenancy/rls.e2e-spec.ts`, `test/tenancy/tenant-tx.e2e-spec.ts`, `test/db/migrations.e2e-spec.ts`, `test/http-pipeline.e2e-spec.ts`, `test/health.e2e-spec.ts`

## Verification

Run on 2026-09-26 against local Postgres 16 + Redis 7 (test DB `ekaro_t103_test` via `TEST_DB_NAME`).

- `pnpm format:check`: all files use Prettier code style.
- `pnpm lint`: 4/4 tasks successful. `pnpm typecheck`: 4/4 tasks successful. `pnpm build`: 4/4 tasks successful.
- `pnpm test`: api **10 files, 54 tests passed**; core 2, contracts 1, web 1 passed.
- `pnpm --filter @ekaro/api test:e2e`: **5 files, 43 tests passed**:
  - `rls.e2e-spec.ts` (19): 0 rows without context; only own rows with context; tenant_id defaulted from context; foreign tenant_id insert rejected (with check); insert without context rejected; cross-tenant update/delete affect 0 rows; a row cannot be moved to another tenant; app sees only its own `tenants` row and cannot update it; audit rows carry old/new jsonb, action, user and request id for INSERT/UPDATE/DELETE; NULL user for system writes; a no-op update writes no audit row; audit_log is tenant-isolated, UPDATE/DELETE denied, a foreign-tenant insert is rejected; partitions are not directly readable; `app_uuidv7()` is v7; `app_enable_tenant_table` is idempotent and rejects tables without `tenant_id uuid not null`; the helpers are owner-only; `app_ensure_audit_partitions(12)` is idempotent and keeps 12 months ahead; `app_grant_platform_read` gives platform read-only access.
  - `tenant-tx.e2e-spec.ts` (8): a request with a tenant in CLS runs in one transaction with tenant/user/request id set; no-tenant requests see no context even on a reused pooled connection (`DB_POOL_MAX=1`); a write commits and is audited with the acting user and `x-request-id`; a handler error rolls back; tenants are isolated across requests on one connection; `runInTenant` works with and without a user, does not leak, and never joins an outer transaction.
  - `migrations.e2e-spec.ts` (3): on a brand-new empty database, all 3 migrations apply, a second run is a no-op, every object is owned by `ekaro_owner`, RLS is forced on `tenants`/`audit_log`, and 13 audit partitions exist.
  - `http-pipeline.e2e-spec.ts` (11) and `health.e2e-spec.ts` (2): request id generated/kept; helmet headers; CORS allow-list with credentials; 400 validation problem with `errors[]`; malformed JSON gives 400 problem; domain error code; 404 problem; 500 hides internals; `/api/v1/health` gives db + redis up.
- `pnpm --filter @ekaro/api db:migrate` twice on `ekaro_t103`: both runs print `migrations applied`, and `drizzle.__drizzle_migrations` holds 3 rows.
- Built app (`node dist/main.js`) with an invalid env exits 1 and prints:

  ```
  Ekaro API failed to start.
  Invalid environment configuration:
    - DATABASE_URL_APP: must be a postgres:// URL
    - DATABASE_URL_PLATFORM: is required
    - JWT_ACCESS_SECRET: is required
    ...
  ```

  With a valid env, `GET /api/v1/health` returns 200 `{"status":"ok",...}` and echoes `x-request-id`. Logs are JSON in production (pretty in development), with `authorization`/`cookie` shown as `[REDACTED]`. SIGTERM shuts down through Nest's shutdown hooks (pools and Redis closed).

- Review: the `code-reviewer` agent could not be invoked from this sub-agent session (no agent tool). A self-review against the backend/database/security/testing standards was done instead. Run `code-reviewer` on this branch before merging.

## Follow-ups

- **T-104:**
  - The JWT guard sets `tenantId`/`userId`/`membershipId` in CLS (`RequestContext`). Global `JwtAuthGuard` + `PermissionGuard` use `isPublicRoute()` / `requiredPermissions()`, and `RequirePermission` narrows to contracts' `Permission`.
  - Platform code uses `PLATFORM_DB` (from `infra/db/platform-db.ts`, only in modules/platform and modules/auth) and sets `app.tenant_id` inside the signup transaction.
  - Grant `ekaro_platform` the DML its bootstrap needs on tenant tables. Call `app_grant_platform_read()` for memberships/roles/company_profile.
  - Add a users factory in `test/factories` once `users` exists. Set Express `trust proxy` before per-IP throttling.
- **Worker (ADR 0011):** a monthly job calling `select app_ensure_audit_partitions(12)` as `ekaro_app`, plus an alert when fewer than 3 future partitions exist.
- **T-105:** Drizzle definition for `audit_log` (partitioned, created by custom SQL). Keep it out of `drizzle-kit generate` (for example with `tablesFilter`).
- **T-102:** align the contracts `problemSchema` with `{ type, title, status, code, detail, errors?: {path, message, code}[], requestId? }`.
- `@nestjs/config` is an unused dependency of `apps/api` (config is Zod-based via `env.ts`). Remove it in a dependency-hygiene pass.
