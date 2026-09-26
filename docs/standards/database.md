# Database standards (PostgreSQL 16)

## Roles

| Role | Used by | Rights |
| --- | --- | --- |
| `ekaro_owner` | migrations only | owns all objects |
| `ekaro_app` | API + workers (tenant work) | DML on tenant tables; **RLS enforced**; no DDL, no `BYPASSRLS` |
| `ekaro_platform` | `modules/platform`, `modules/auth` only (lint-enforced) | DML on platform tables (`tenants`, `users`, `refresh_tokens`, ...). Has `BYPASSRLS` because login, tenant switching and signup bootstrap run before a tenant context exists. Every use is audited in code review |

## Table rules

- Every table has a primary key `id uuid` holding **UUIDv7** (time-ordered). The app generates it with `uuidv7()` from `@ekaro/core`.
- Every tenant-owned table has:
  - `tenant_id uuid not null references tenants(id)`
  - `created_at timestamptz not null default now()`, `created_by uuid`, `updated_at timestamptz not null default now()`, `updated_by uuid`
  - `version integer not null default 1` for mutable records (optimistic locking)
  - `alter table ... enable row level security; alter table ... force row level security;`
  - policy `tenant_isolation`: `using (tenant_id = app_current_tenant()) with check (tenant_id = app_current_tenant())`
- `app_current_tenant()` returns `nullif(current_setting('app.tenant_id', true), '')::uuid`. When the setting is missing it returns null, so the query sees **zero rows** (fail closed).
- Unique constraints on business keys always include `tenant_id` (for example `unique (tenant_id, code)`).
- Foreign keys between tenant tables are composite `(tenant_id, x_id)` where cross-tenant linkage must be impossible. The minimum is a plain FK plus RLS.
- Masters are never deleted once referenced. Use `is_active boolean not null default true`. Hard delete is allowed only for unreferenced drafts.

## Types

| Data | Type |
| --- | --- |
| money amounts (line totals, taxes, ledger amounts, balances, credit limits) | `bigint` paise |
| unit rates / prices | `numeric(20,6)` rupees per unit (see accounting standard for rounding) |
| quantities | `numeric(20,6)` |
| percentages (GST rate, scrap %) | `numeric(7,4)` |
| document dates | `date`; event times `timestamptz` |
| enums | Postgres `text` + `check` constraint (easier to migrate than `enum` types), mirrored by a Zod enum in contracts |
| GSTIN | `char(15)` validated by checksum in app + regex check constraint |
| codes / names | `text` with length check constraints |

## Migrations

- Drizzle schema is the source of truth for tables. `pnpm --filter @ekaro/api db:generate` produces SQL in `apps/api/db/migrations`.
- Hand-written SQL (RLS helpers, triggers, grants, functions) goes in custom migrations (`drizzle-kit generate --custom`). Every RLS table's migration includes its enable/force/policy/grant statements.
- Migrations are **forward-only and never edited after merge**. Destructive changes go through expand → migrate → contract across releases.
- Every migration must run cleanly on an empty DB **and** on a DB at the previous version (CI checks both).

## Audit

- The generic trigger `audit_row_change()` is attached to every tenant table (AFTER INSERT/UPDATE/DELETE). It writes `audit_log(tenant_id, table_name, row_id, action, old_data jsonb, new_data jsonb, changed_by, changed_at, request_id)`.
- `audit_log` is append-only. `ekaro_app` has INSERT and SELECT only. Keep 8 years (BRD §10).

## Ledgers

- `stock_ledger_entries` and `gl_entries` are append-only (no UPDATE or DELETE grant for `ekaro_app`). A reversal inserts negating rows that link to the original.
- Balances are derived. Cached summary tables are allowed only if they are rebuilt and reconciled by the nightly integrity job.

## Performance

- Index every FK, and `(tenant_id, <common filter>)` for list screens. Every list query must be index-backed (check `EXPLAIN` in review for new heavy queries).
- Use keyset pagination for ledgers and large reports. Offset pagination is fine for masters.
- No N+1 queries. Use joins or batched `inArray` queries.
