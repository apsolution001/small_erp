---
id: T-105
title: Users, invitations, roles, audit-log API
status: done
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/01-platform-auth-access.md §3.3–3.4
---

## Scope

Invitations (with an outbox row for the email; the email adapter is SMTP to Mailpit), accepting an invitation, membership list and update (role, branches, status) with the safety rules, role CRUD and clone, and a paginated keyset audit-log query.

## Acceptance criteria

Every rule in spec 01 §3.3 has a test: no changing your own role, never disabling the last Owner, only an Owner assigns Owner, a role in use cannot be deleted, and system roles cannot be deleted.

## Decisions

The architectural ones are in [ADR 0017](../adr/0017-user-directory-grants-outbox.md). In short:

1. **User directory (T-104 follow-up).** `ekaro_app` gets a column grant on `users (id, email, full_name, mobile, status)` and a `tenant_member_read` policy: a user row is visible only while a membership of the tenant in context points at it (the subquery runs under `memberships`' own RLS). The auth module exposes it as the `security_invoker` view `tenant_users` (Drizzle `tenantUsers`), which tenant modules join. No SECURITY DEFINER code, and no password hash, TOTP secret or lockout state is reachable.
2. **Audit row keys (T-104 follow-up).** `audit_row_change()` takes the key column as a trigger argument, and `app_enable_tenant_table(table, row_key default 'id')` validates and passes it. `company_profile` rows are keyed by `tenant_id` and `membership_branches` rows by `membership_id`. Existing audit rows are backfilled in the migration. The single-argument call still works for tables enabled elsewhere (T-106–T-108).
3. **Cache invalidation after commit (T-104 follow-up).** New `TenantContext.afterCommit()`. Role edits call `invalidateTenant`, membership changes `invalidateMembership`, both only after the request transaction commits (never after a rollback; failures are logged). Tested end to end: role, branch-scope and status changes apply to the member's very next request.
4. **Owner rules use `roles.is_owner`** and `Principal.isOwner` (from the access snapshot), never the role name. The Owner role may be renamed (by an Owner), but its permissions (computed, none stored) and billing flag never change: 422 `SYSTEM_ROLE_IMMUTABLE`.
5. **Safety rules** (pure functions in `modules/access/access-rules.ts`):
   - No changing your own role (422 `SELF_ROLE_CHANGE`), and no disabling yourself (422 `SELF_DISABLE`, new code).
   - Only an Owner assigns the Owner role, or changes an Owner's role or status (403 `OWNER_ASSIGNMENT_FORBIDDEN`).
   - Never demote or disable the last active Owner (422 `LAST_OWNER`). The service counts the other active Owner memberships with an active user under `SELECT … FOR UPDATE`, so two Owners demoting each other at once cannot both succeed (tested with concurrent requests).
   - **Nobody grants more than they hold** (403 `PERMISSION_NOT_HELD`, new code): creating, editing (before and after), cloning or deleting a role, inviting with a role and assigning a role all require the actor to hold all its permissions. Without this an Admin could give billing access through a custom role.
   - Status codes: rule violations 422, authority 403, conflicts 409 (backend standard).
6. **Free roles are read-only** (BRD §12). A non-billable role may hold only `:view` and `:export` permissions, enforced by the contracts (`roleCreateSchema`, new `roleRecordSchema` for merged PATCH validation), so the web shares the rule.
7. **Roles:** system roles are never deleted (422 `SYSTEM_ROLE_IMMUTABLE`); a role held by a membership or an open (pending or expired) invitation is 409 `ROLE_IN_USE`. The delete locks the role row first, and a concurrent assignment that slips past is mapped from the FK or check violation to the same 409. Clone copies the effective permissions into an ordinary role (cloning the Owner role gives an ordinary role with the whole catalogue). Role responses gain `isOwner`.
8. **Invitations:**
   - Table `invitations` (tenant, RLS, audited): email (citext), `role_id`, `all_branches`, `branch_ids uuid[]`, `token_hash`, `expires_at` (7 days), `accepted_at`, `revoked_at`. One open invitation per email (partial unique index); inviting again revokes the old one, which is how an invitation is re-sent.
   - `role_id` references `roles (tenant_id, id)` with `ON DELETE SET NULL (role_id)` (declared in the SQL migration, which Drizzle cannot express), and a check forbids a null role on an open invitation. A role can be deleted once its invitations are closed; they keep their history.
   - The status (`pending | expired | accepted | revoked`) is derived in SQL from the database clock.
   - Inviting an existing member is 409 `ALREADY_EXISTS`. An unknown role or an unknown or inactive branch is 422 on its field.
   - Revoking needs `access.user:delete` (it withdraws a user who never joined). Revoking a closed invitation is 409 `INVALID_TRANSITION`.
9. **Accepting (public, in `modules/auth`):**
   - `POST /auth/invitations/preview` and `POST /auth/accept-invitation`, with the token in the body.
   - A new email must send a name and a password (policy and common-password check). An existing active user sends the token only; a password is refused (422 `existing_user`), so a link can never overwrite a password.
   - No session is started: the user signs in next, so an invitation link alone never opens an existing account that may belong to other companies.
   - The flow runs in one platform transaction: create the user if new (`email_verified_at` = now, since the link proves the mailbox), set the invitation's tenant and the accepting user as the context, then lock the invitation, re-check it, insert the membership and branch scope, and close it.
   - Unknown, used and revoked links are all 404 `INVITATION_INVALID`; an expired one is 422 `INVITATION_EXPIRED`. A suspended company is 403 `TENANT_SUSPENDED`, and an existing member is 409.
   - `ekaro_platform` gains `platform_read` and UPDATE on `invitations`.
10. **Outbox (ADR 0011):**
    - Table `outbox` (tenant, RLS forced, INSERT only for `ekaro_app`, not audited so tokens never reach `audit_log`).
    - `OutboxWriter.enqueue(topic, payload)` validates against the per-topic Zod schema in `outbox.messages.ts` (`email.user_invitation`).
    - The link is `<APP_ORIGIN>/accept-invitation#token=<43 chars>`: in the fragment, so it never reaches server logs or `Referer`.
    - The relay worker and SMTP adapter are not built yet (see Follow-ups).
11. **Audit query:**
    - `GET /audit-logs` takes `table`, `rowId`, `userId`, `action`, `from` (inclusive), `to` (exclusive), `cursor` and `limit` (default 50, max 200), newest first.
    - Keyset on `(changed_at, id)`. The cursor carries the exact microsecond timestamp printed by Postgres (a JS `Date` would drop microseconds and skip or repeat rows). One extra row is fetched to know whether a next page exists.
    - `changedAt` is returned with microseconds. `changedBy` is `{ id, name }`, with the name from the user directory.
    - EXPLAIN shows ordered index scans on `(tenant_id, changed_at desc, id desc)` per partition, and the directory join is removed when unused.
    - `audit_log` is read through a Drizzle table object kept out of `schema.ts`, so drizzle-kit never generates DDL for the partitioned table.
12. **Users list:** memberships inner-joined with `tenant_users` and roles, with `branchIds` aggregated in a sorted subquery. `q` matches name or email (ILIKE, with wildcards escaped). Sorts: `fullName` (case-insensitive), `email`, `createdAt`, each with an `id` tie-breaker. `GET /users/:membershipId` was added for the edit form.
13. **Shared helpers added:**
    - `common/crypto/opaque-token` (refresh tokens and invitation links).
    - `infra/tenancy/transaction-context` (the one `set_config` for the tenant tx, the bootstrap and acceptance) and `current-principal`.
    - `infra/db/list-query` (allow-listed ORDER BY, escaped patterns, offsets).
    - `pg-errors` (FK and check violations) and `versionConflict()`.
    - masters `findActiveBranchIds` (executor-based, ADR 0015).
14. **Test harness fix:** `loadTestEnv` pins `REFRESH_COOKIE_SECURE=true`. With the example `.env` copied in (as this task's setup does), two T-104 cookie tests failed on a clean checkout; the tests must not depend on the developer's local http setting.
15. **Migrations (parallel work with T-106–T-108):** one generated file `0007_t105_invitations_outbox.sql` and one custom file `0008_t105_users_roles_audit_security.sql`. They were regenerated on top of the base's `0005`/`0006_sec_sessions_lockout*` after merging the T-104 security fixes, so the Drizzle snapshot chain is consistent. The lead renumbers them again at the masters merge if needed. If a masters migration calls `app_enable_tenant_table` before 0008, it still works (default key `id`).
16. **Sessions of a changed membership (after the T-104 security merge).** The auth module exports no service that revokes a membership's sessions, and `access` cannot depend on `auth` (auth imports access). So a membership disable or role change relies on what already holds: the after-commit `invalidateMembership` makes the very next request load fresh access (a disabled membership gets 403 at once; a role change applies at once), and the next refresh of such a session revokes its family (`access_revoked`). Access tokens never outlive the per-request check. Revoking sessions eagerly is a follow-up for when auth exposes it.

## Plan

- [x] Contracts: `roleRecordSchema` + free-role rule, `isOwner`, invitation status/list/preview/acceptance, audit query/entry/page, error codes `PERMISSION_NOT_HELD` and `SELF_DISABLE`
- [x] Infra: `afterCommit`, `applyTransactionContext`, opaque tokens, list-query, pg-errors, outbox table/writer/messages
- [x] Migrations `0007_t105_invitations_outbox` (generated) and `0008_t105_users_roles_audit_security` (audit key + backfill, invitations RLS/FK/platform access, outbox RLS/grant, user directory)
- [x] Access: rules (+ spec), roles repo/service/controller, users repo/service/controller, invitations repo/service/controller, acceptance queries (+ service specs)
- [x] Auth: `InvitationAcceptanceService`, preview and accept routes
- [x] Audit module: cursor (+ spec), repository, service (+ spec), controller
- [x] e2e: users + invitations + acceptance, roles, audit paging/isolation, isolation for `invitations`/`outbox`/user directory, after-commit, route audit, migration count
- [x] ADR 0017, spec 01 §3.3–3.4, task board
- [x] Merged the T-104 security fixes (`claude/brave-dirac-k9ikzp`): migrations renumbered to 0007/0008, ADR renumbered to 0017, test DBs recreated, full gate re-run

## Verification

Final run on 2026-09-26, after merging `claude/brave-dirac-k9ikzp` (the T-104 security fixes), against local Postgres 16 and Redis 7. `ekaro_t105` and `ekaro_t105_test` were dropped and recreated. Before the merge the same migration SQL also ran on a T-104 database that already held data, backfilling its `company_profile` and `membership_branches` audit keys. The base's 0005/0006 do not touch `audit_log`.

- `pnpm format` then `pnpm format:check`: clean.
- `pnpm lint`: 4/4 successful. `pnpm typecheck`: 4/4 successful. `pnpm build`: 4/4 successful.
- `pnpm test`: core **127** (100% coverage), contracts **319** (100% statements, branches, functions and lines), web **1**, api **195** passed (35 files). New api specs:
  - `access-rules` (17), `roles.service` (13), `users.service` (7), `invitations.service` (5)
  - `audit-log.service` (3), `audit-cursor` (2), `opaque-token` (3), `list-query` (5), `pg-errors` (+1)
- `TEST_DB_NAME=ekaro_t105_test pnpm --filter @ekaro/api test:e2e`: **15 files, 219 tests passed**:
  - `access/users.e2e-spec.ts` (29):
    - The list (names from the directory, filters, sort, paging, 422 on unknown params) and cross-tenant 404s. `access.user:view` and `:edit` allowed for Admin, denied for Sales and Viewer, 401 without a session.
    - Every §3.3 rule: `SELF_ROLE_CHANGE` (Admin and Owner), `SELF_DISABLE`, `OWNER_ASSIGNMENT_FORBIDDEN` (assign, demote, disable), `LAST_OWNER` (deterministic), and concurrent mutual demotion leaving exactly one Owner (repeated 5/5). Also `PERMISSION_NOT_HELD`, merged-record, role and branch validation, and `VERSION_CONFLICT`.
    - Role, branch-scope and status changes apply to the member's next request. Branch rows are audited with `row_id` = membership.
    - Invitations: the outbox email (link origin and fragment, company, inviter), only the token hash stored, audited once. Re-invite revokes the old link; existing member 409; unknown role or branch 422. Owner-role invite by an Admin is 403, and a role beyond the Admin's permissions is 403.
    - Invitation permissions: `access.user:create`, `:view` and `:delete`. Revoke gives 204 then 409, and B gets 404. The status filter derives `expired`.
    - Acceptance: preview; a new user with validation, common-password check, login and membership audited as the new user; the link works once; an existing user accepts by token only and a password is refused; expired 422; revoked, unknown or malformed 404; a suspended company 403 `TENANT_SUSPENDED`; an existing member meanwhile gets 409 and the invitation stays open.
  - `access/roles.e2e-spec.ts` (23):
    - The list with effective permissions and `isOwner`; search, sort and page.
    - Create 201, duplicate name 409 in any case (another tenant may reuse it), free-role, unknown-permission and unknown-key 422, `PERMISSION_NOT_HELD`.
    - Edit with version (409 when stale), a merged free-role violation, and edits applying to holders at once. The Owner role: 422 for permissions and billing; renamed by the Owner, 403 for an Admin.
    - Delete: system 422, held by a user 409, held by a pending invitation 409, deleted after the revoke (the invitation keeps `role: null`), beyond the actor 403.
    - Clone: of a system role, of the Owner role by the Owner, 403 beyond the actor, 409 on a taken name.
    - Every endpoint has allowed and denied permission tests, and a cross-tenant 404.
  - `audit/audit-log.e2e-spec.ts` (6):
    - Paging 6 rows of one role in pages of 2, 2 and 2 with no gaps or repeats, strictly ordered, with microsecond `changedAt`, old and new data, and the actor's name.
    - Filters by user, action and window (inclusive `from`, exclusive `to`).
    - `company_profile` rows are keyed by the tenant and `membership_branches` rows by the membership; no unkeyed audit rows remain.
    - Tenant isolation, by filter, by paging everything and with a replayed cursor.
    - Accountant allowed, Sales 403, no session 401. A forged cursor, a bad table, a large limit, an unknown param and an inverted window are all 422.
  - `tenancy/isolation.e2e-spec.ts` (37):
    - `invitations` added to the matrix (forced RLS, `platform_read`, audit trigger, B cannot read, update or delete).
    - `ekaro_app` is denied sessions, refresh tokens, every private `users` column and any write, and sees exactly its tenant's members in `tenant_users`.
    - `outbox` has forced RLS, no trigger, and is insert-only for `ekaro_app` in its own tenant.
  - `tenancy/tenant-tx.e2e-spec.ts` (12): `afterCommit` runs in order after the commit (data visible to other connections), never after a rollback, a failing callback is logged, and it is refused outside a transaction.
  - `access/permissions.e2e-spec.ts` (21): the route audit pins the two new public invitation routes; every new route declares a permission.
  - `db/migrations.e2e-spec.ts` (3): 16 tables, all with forced RLS, and every object owned by `ekaro_owner`, the `tenant_users` view included.
  - Base suites green: access-cache (3), signup (18), sessions (22), lockout (7), throttling (5), rls (19), http-pipeline (12), health (2).
- `db:migrate` on a fresh `ekaro_t105` (0000 to 0008): `migrations applied`.
- EXPLAIN of the audit keyset query (as `ekaro_app` in a tenant context): ordered index scans on `(tenant_id, changed_at, id)` per partition, and the unused directory join is removed.
- Review: this sub-agent session has no agent tool, so the `code-reviewer` agent could not be run. A self-review against the backend, database, security and testing standards was done instead. Run `code-reviewer` on this branch before merging.

## Follow-ups

- **Outbox relay + SMTP adapter (worker, ADR 0011/0012):**
  - Relay unpublished `outbox` rows to BullMQ, keyed by `id`.
  - Grant the worker role read and update on `outbox` then, with a policy for it.
  - Build the email port with a Mailpit/SMTP adapter that renders `email.user_invitation`.
  - Never log payloads (they carry the link).
- **Merge (lead):** renumber `0007_t105_invitations_outbox` and `0008_t105_users_roles_audit_security` after the masters migrations if needed, and regenerate the Drizzle snapshot. The masters tasks can use `findActiveBranchIds` (masters `index.ts` gained that export).
- **Masters (T-106):** deactivating a branch does not touch memberships or open invitations that name it. Acceptance refuses an invitation whose branch became inactive (422 `INVITATION_INVALID`), and a PATCH keeps already-assigned inactive branches but refuses new ones. Decide in T-106 whether deactivation should block or cascade.
- **Platform user disable:** there is still no API to disable a platform user. When there is, call `invalidateMembership` for each of their memberships. The last-Owner count already ignores Owners whose user is disabled.
- **Eager session revocation (auth):** disabling a membership or changing its role already applies at the next request, and the next refresh revokes the session (`access_revoked`). When auth exports a `revokeMembershipSessions`, call it after commit (Decision 16).
- **T-151 (web), the API contract:** see the list below.

### API for T-151

All routes are under `/api/v1` with `Authorization: Bearer <access token>` unless marked public. Errors are problem+json: 422 `VALIDATION_FAILED` has `errors[{path, message, code}]`. Every PATCH sends `version`; a stale one is 409 `VERSION_CONFLICT`.

- **Users** (`id` = membership id):
  - `GET /users?page&pageSize&q&sort=fullName|email|createdAt:asc|desc&status=invited|active|disabled&roleId` → `{ data: UserResponse[], meta: { page, pageSize, total } }` (`access.user:view`). `UserResponse` is `{ id, version, createdAt, updatedAt, userId, email, fullName, mobile, role: { id, name }, allBranches, branchIds, status, joinedAt }`.
  - `GET /users/:id` → `UserResponse`.
  - `PATCH /users/:id { roleId?, allBranches?, branchIds?, status?: 'active'|'disabled', version }` → `UserResponse` (`access.user:edit`), validated as the merged `userRecordSchema`. Errors: 422 `SELF_ROLE_CHANGE`, `SELF_DISABLE`, `LAST_OWNER` and field errors (`roleId`, `branchIds`, `status`); 403 `OWNER_ASSIGNMENT_FORBIDDEN`, `PERMISSION_NOT_HELD`; 404; 409 `VERSION_CONFLICT`.
- **Invite:**
  - `POST /users { email, roleId, allBranches = true, branchIds = [] }` → **201** `InvitationResponse` (`access.user:create`). `InvitationResponse` is `{ id, email, role: {id,name} | null, allBranches, branchIds, status: pending|expired|accepted|revoked, invitedBy: {id,name} | null, expiresAt, acceptedAt, revokedAt, createdAt }`.
  - Errors: 409 `ALREADY_EXISTS` (already a user); 422 on `roleId` or `branchIds`; 403 `OWNER_ASSIGNMENT_FORBIDDEN`, `PERMISSION_NOT_HELD`. Inviting the same email again replaces the open invitation, which is how to "resend".
- **Invitations:**
  - `GET /invitations?page&pageSize&q&status&sort=email|createdAt|expiresAt:asc|desc` → page of `InvitationResponse` (`access.user:view`; default sort `createdAt:desc`).
  - `DELETE /invitations/:id` → 204 (`access.user:delete`); 409 `INVALID_TRANSITION` if it is already closed.
- **Accept page** (public; route `/accept-invitation`, token in `location.hash` as `#token=…`):
  - `POST /auth/invitations/preview { token }` → `{ email, companyName, roleName, invitedByName, expiresAt, existingUser }`.
  - `POST /auth/accept-invitation { token }` (existing user) or `{ token, fullName, password }` (new user) → 200 `{ email, tenant: { id, name }, userCreated }`, with no cookie. Then send the user to login with the email filled in.
  - Errors: 404 `INVITATION_INVALID`; 422 `INVITATION_EXPIRED`; 422 `VALIDATION_FAILED` (`fullName`/`password` `required`, `password` `too_common`, `password` `existing_user`); 401 `ACCOUNT_DISABLED`; 403 `TENANT_SUSPENDED`; 409 `ALREADY_EXISTS`. The auth rate limits apply (429).
- **Roles:**
  - `GET /roles?page&pageSize&q&sort=name|createdAt:asc|desc` and `GET /roles/:id` → `RoleResponse { id, version, createdAt, updatedAt, name, description, permissions (effective, catalogue order), isSystem, isOwner, isBillable }` (`access.role:view`).
  - `POST /roles { name, description?, permissions?, isBillable? }` → 201 (`access.role:create`).
  - `PATCH /roles/:id { name?, description?, permissions?, isBillable?, version }` → 200 (`access.role:edit`).
  - `DELETE /roles/:id` → 204 (`access.role:delete`).
  - `POST /roles/:id/clone { name }` → 201 (`access.role:create`).
  - Errors: 409 `ALREADY_EXISTS` (name, case-insensitive), `ROLE_IN_USE`, `VERSION_CONFLICT`; 422 `SYSTEM_ROLE_IMMUTABLE` (delete a system role; edit the Owner role's permissions or billing), free-role `permissions` error; 403 `PERMISSION_NOT_HELD`, `OWNER_ASSIGNMENT_FORBIDDEN` (edit the Owner role as a non-Owner).
  - UI hints: lock the permission matrix and billing for `isOwner`, and hide delete for `isSystem`. When `isBillable` is off, allow only `:view` and `:export` (the same rule as `roleCreateSchema` and `roleRecordSchema`). Offer only permissions the signed-in user holds (`/auth/me` `permissions`).
- **Audit:** `GET /audit-logs?table&rowId&userId&action=INSERT|UPDATE|DELETE&from&to&cursor&limit(≤200, default 50)` → `{ data: [{ id, tableName, rowId, action, oldData, newData, changedBy: {id, name|null} | null, changedAt (µs ISO), requestId }], meta: { limit, nextCursor | null } }` (`audit.log:view`). Pass `nextCursor` back as `cursor` for older rows.
