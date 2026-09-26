# 0014 — Tenant context plumbing: DB-side defaults, request transactions, audit storage

**Status:** Accepted · 2026-09-26 · refines ADR 0003, 0004 and 0008 (T-103)

## Context

ADR 0003 puts tenant isolation in Postgres (RLS on `app_current_tenant()`), and ADR 0008 puts the audit trail in a trigger. T-103 had to decide how the tenant context reaches every statement, who fills the tenant and actor columns, how jobs run as a tenant, and how `audit_log` is keyed and partitioned.

## Decision

1. **The database fills the context columns.** `tenantTable()` declares `tenant_id default app_current_tenant()`, `created_by` / `updated_by default app_current_user()` (and Drizzle re-stamps `updated_at = now()`, `updated_by = app_current_user()` on update). Repositories never pass them, so the tenant can never come from request input. The RLS `with check` still rejects an explicit foreign `tenant_id`, and with no context the insert fails closed.
2. **One transaction per authenticated request.** `TenantTxInterceptor` (global) opens a transaction on the `ekaro_app` pool through `@nestjs-cls/transactional` and first runs one `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.request_id', $3, true)`. It acts only when the CLS context has a `tenantId` (set by the JWT guard, T-104). Public and platform requests pass through with no tenant transaction. The handler's result is awaited inside the transaction, so the commit happens before the response is written.
3. **Jobs use `TenantContext.runInTenant(tenantId, userId | null, fn)`.** It opens a new CLS context and a new transaction (`Propagation.RequiresNew`), so a job can never join, or switch the tenant of, a surrounding transaction.
4. **`tenants` is RLS-protected too.** `ekaro_platform` manages it (`platform_all`). `ekaro_app` can read only the row of the tenant in context (`tenant_self_read`), not the whole tenant list. No role may delete a tenant: tenants are closed by status.
5. **`audit_log` storage.**
   - The key is `(id uuid default app_uuidv7(), changed_at)`: a UUIDv7 generated in SQL, because the trigger has no app to ask, and a partitioned table's key must include the partition column.
   - It is partitioned by UTC month. `app_ensure_audit_partitions(months_ahead)` (SECURITY DEFINER, executable by `ekaro_app`) creates the missing partitions. The migration creates the current month plus 12, and a monthly worker job keeps 12 months ahead.
   - There is deliberately no DEFAULT partition. Its rows would block creating the partition for their month, and 12 months of headroom plus the job make a gap an operational alert rather than a design case.
   - `audit_log` has no FK to `tenants`, which keeps the write path cheap. `tenant_id` always comes from a row that already passed RLS.
   - Partitions carry no grants and are reachable only through the RLS-protected parent.
   - The trigger is SECURITY INVOKER, so its insert passes the same tenant check as the audited write. `ekaro_platform` also holds INSERT, because signup bootstrap writes tenant rows.
6. **Deny-by-default privileges.** Functions created by `ekaro_owner` are not executable by PUBLIC. The context functions are granted to `ekaro_app` and `ekaro_platform`. `app_enable_tenant_table` and `app_grant_platform_read` stay owner-only (migrations).

## Consequences

- A repository that forgets the tenant cannot write the wrong tenant: the default and the policy come from the same setting.
- Every authenticated request pays for one extra statement (`set_config`) and holds a connection for its whole duration. Long-running work belongs in jobs, not requests.
- Streaming responses (SSE, large downloads) cannot run inside the request transaction. Such endpoints must do their DB work first, or use `runInTenant` explicitly.
- Operations must monitor the partition job. A month without a partition makes audited writes fail, which fails closed.
