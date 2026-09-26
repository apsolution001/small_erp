---
id: T-103
title: 'API foundation: config, logging, errors, DB roles, RLS helpers, audit trigger, tx context, test harness'
status: in-progress
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
