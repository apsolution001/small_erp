# 0016 — User directory for tenant code, granting authority, audit row keys and the outbox table

**Status:** Accepted · 2026-09-26 · refines ADR 0007, 0008, 0011 and 0015 (T-105)

## Context

T-105 adds user management (memberships joined with users), invitations, role management and the audit-log query. Four questions were open:

- `users` is a platform table that `ekaro_app` cannot read at all (ADR 0015), yet the tenant's user list, the audit log's "changed by" and the invitation email all need names and emails.
- ADR 0007 lets holders of `access.role:*` and `access.user:*` create roles and assign them. Nothing stopped an Admin (everything except billing) from creating a role with `platform.billing:*` and assigning it to another account, or a free role from carrying write permissions.
- The audit trigger read `row_id` from an `id` column, so `company_profile` (keyed by `tenant_id`) and `membership_branches` (keyed by `(membership_id, branch_id)`) wrote audit rows with a NULL `row_id`, which the audit query cannot filter on.
- ADR 0011 names an outbox, but no table existed. An invitation email carries a bearer link, which must not leak through the audit trail or the API.

## Decision

1. **The user directory is a column grant, a policy and a `security_invoker` view.**
   - `ekaro_app` gets `SELECT (id, email, full_name, mobile, status) ON users` and nothing else: no password hash, TOTP secret or lockout state, and no write.
   - A policy `tenant_member_read … FOR SELECT TO ekaro_app USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id))`. The subquery runs as `ekaro_app`, so `memberships`' own `tenant_isolation` limits it to the tenant in context: a user is visible exactly while one of this tenant's memberships points at them. There is no SECURITY DEFINER code and no tenant filter written by hand.
   - The view `tenant_users (id, email, full_name, mobile, status)` is `security_invoker`, so it adds no privilege. It is the auth module's named read surface (Drizzle `tenantUsers` in `modules/auth/users/tenant-users.view.ts`, `.existing()`); tenant modules join it instead of `users`.
   - Rejected: a SECURITY DEFINER function (it would hand-code the tenant filter and run as a role that sees every user); reading through the platform connection from tenant modules (the lint boundary forbids it, and it would join across two connections).
2. **Nobody grants more than they hold.** Creating, editing, cloning or deleting a role, inviting with a role, and changing a membership's role all require the actor to hold every permission of the role involved (before and after an edit), else 403 `PERMISSION_NOT_HELD`. The Owner role, and any Owner's membership, can be assigned or changed only by an Owner (403 `OWNER_ASSIGNMENT_FORBIDDEN`, spec 01 §3.3). The rules are pure functions in `modules/access/access-rules.ts`.
3. **Free roles are read-only** (BRD §12: CA and Viewer never count toward billing). A non-billable role may hold only `:view` and `:export` permissions. The rule lives in the contracts (`roleCreateSchema`, `roleRecordSchema`) so the web applies it too. The Owner role is always billable and its permissions are never stored or edited; its name and description may change (ADR 0015 §9).
4. **Audit rows always carry their row key.** `audit_row_change()` takes the key column as an optional trigger argument (default `id`), and `app_enable_tenant_table(table, row_key default 'id')` passes it and checks it is a `uuid not null` column. `company_profile` is keyed by `tenant_id`; a `membership_branches` row is keyed by its `membership_id`, so a membership's branch-scope history is found with `table=membership_branches&rowId=<membership id>`. The migration backfills the existing rows (the owner lifts `FORCE ROW LEVEL SECURITY` on `audit_log` for those two statements only, inside the migration transaction).
5. **The outbox is a tenant table, insert-only for `ekaro_app`, and not audited.** `outbox (id, tenant_id, topic, payload jsonb, created_at, created_by, request_id, published_at, attempts, last_error)`, RLS forced with `tenant_isolation`. `ekaro_app` holds INSERT only, so no API user can read a payload back. It has no audit trigger: it is a delivery queue, not business data, and auditing would copy invitation tokens into `audit_log`, which audit viewers can read. The change that enqueues a message (the invitation) is audited. `OutboxWriter.enqueue(topic, payload)` validates the payload against the topic's Zod schema (`outbox.messages.ts`); the relay worker (later) parses with the same schema and receives its own grant then.
6. **Cache invalidation runs after commit.** `TenantContext.afterCommit(callback)` queues work that runs once the tenant transaction commits and never after a rollback; a failing callback is logged. Role edits call `AccessCache.invalidateTenant`, membership changes `invalidateMembership`. Invalidating before the commit would let a concurrent request refill the cache with the old snapshot.
7. **Invitation links carry the token in the URL fragment** (`<APP_ORIGIN>/accept-invitation#token=…`), which browsers never send to a server, so it stays out of access logs, proxies and `Referer` headers. The page posts it to `POST /auth/invitations/preview` and `POST /auth/accept-invitation`. Accepting starts no session: an invitation link alone never opens an existing account (which may belong to other companies).

## Consequences

- Tenant code can show names and emails without any access to credentials, and a user disappears from a tenant's directory only if their membership row is removed (memberships are disabled, never deleted, so audit names stay resolvable).
- Changing an Owner-held or billing-bearing role needs an Owner. An Admin can still run day-to-day user management.
- Tables enabled with `app_enable_tenant_table('x')` elsewhere keep working unchanged (default key `id`).
- The relay worker must be given read and update access to `outbox` when it is built, and it must never log payloads.
