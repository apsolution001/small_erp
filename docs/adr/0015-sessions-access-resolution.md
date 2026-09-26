# 0015 — Sessions, access resolution and platform access to module tables

**Status:** Accepted · 2026-09-26 · refines ADR 0003, 0006, 0007 and 0014 (T-104)

## Context

T-104 had to turn ADR 0006 (JWT + rotating refresh tokens) and ADR 0007 (permission RBAC) into running code on top of the T-103 plumbing. Four questions were open:

- Signup and login need other modules' tables (masters, roles, memberships) on the `ekaro_platform` connection, which only `modules/platform` and `modules/auth` may use. Yet the backend standard says a module never writes another module's tables.
- Where authentication lives, when the user's status sits in a platform-only table.
- How a session, its refresh tokens and the permission cache fit together.
- How validation failures are reported, now that the contracts reject unknown keys.

## Decision

1. **Owning modules expose executor-based functions.** A module that owns tables exposes the queries and seeds that platform code needs as plain functions taking a `DbExecutor` (a Drizzle client or transaction on either connection): `seedTenantMasters`, `findCompanyNames` (masters), `seedSystemRoles`, `ensureOwnerMembership`, `loadMembershipAccess`, `findActiveMembershipsOfUser` (access). The caller picks the connection. The SQL for a table still lives in its module. Only `platform` and `auth` ever pass the platform connection.
2. **Bootstrap runs in the signup transaction.** One platform transaction creates the user, the tenant, the seeds and the first refresh token. `TenantBootstrapService` first runs `set_config('app.tenant_id' | 'app.user_id' | 'app.request_id', …, true)`, so every seed passes the ordinary `tenant_isolation` check and is audited as written by the owner. `ekaro_platform` gets `SELECT, INSERT` on the nine bootstrap tables. On the tables without `platform_read`, `tenant_isolation` limits that SELECT to the tenant in context, so it can read back only what it is seeding. Every seed is `ON CONFLICT DO NOTHING` on its business key, so the bootstrap is idempotent.
3. **Authentication lives in `auth`, authorization in `access`.** `JwtAuthGuard` (`modules/auth`) needs the user's status from the platform-only `users` table, so it cannot live in `access`, which may not import the platform connection. `PermissionGuard` lives in `modules/access`. `AppModule` registers both as `APP_GUARD` in that order. A route is `@Public()` (with a justification), `@Authenticated()` (any session: `/auth/me`, `/auth/switch-tenant`) or `@RequirePermission(...)`. Anything else is refused with 403, even for the Owner. An e2e test lists every route of the app and fails on one without a declaration, or on an unexpected public route.
4. **The access snapshot is the unit of caching.** The guard verifies the token, then loads an `AccessSnapshot` for its membership: role, effective permissions (Owner = the whole catalogue, computed by `effectivePermissions` in contracts), branch scope, and the membership, user and tenant statuses. It is cached in Redis as one hash per tenant, one field per membership, each entry valid for 60 seconds and validated with Zod on read. The invalidation hooks are `AccessCache.invalidateMembership(tenantId, membershipId)` (role, branches or status changed, user disabled) and `invalidateTenant(tenantId)` (a role's permissions changed, the tenant's status changed). A Redis failure on read or write falls back to the database and never fails the request. Login, refresh and switch always read fresh.
5. **Session = refresh-token family = the access token's `sid`.** Each refresh token row stores its hash, family, membership, expiry, IP and user agent.
   - Rotation locks the presented row (`SELECT … FOR UPDATE`), inserts the successor and marks the old row `rotated` with `replaced_by_id`.
   - **Any revoked token presented again is reuse**, whatever the reason it was revoked (rotated, logout, switched). The whole family is revoked (`reuse_detected`) and the response is 401 `REFRESH_REUSED`. There is deliberately no grace window: two tabs racing on one token sign the user out, which is safer than accepting a replay.
   - Logout revokes the family. Switch-tenant starts a new family for the other membership and then revokes the old one (`switched`). A refresh whose user, membership or tenant lost access revokes the family (`access_revoked`).
   - The cookie is `ekaro_refresh`: `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, `Expires` = the token expiry (30 days, sliding on rotation). `Secure` is controlled by `REFRESH_COOKIE_SECURE` (default true; env validation refuses false in production; the local `.env` sets false for http).
6. **Tenant selection** uses a JWT with the same key, a 5-minute lifetime and its own audience (`<JWT_AUDIENCE>:tenant_selection`), so neither token type can stand in for the other.
7. **Rate limits use a Redis fixed window** (one Lua script per hit, with a block marker). The named throttlers are `auth-ip` (per client IP per auth route), `auth-account` (per email on signup and login) and `gstin-ip`. Controllers opt in with `ThrottlerGuard`. Express `trust proxy` is `TRUST_PROXY_HOPS` (0 = ignore `X-Forwarded-For`), so a client cannot choose its own IP.
8. **Validation failures are 422 `VALIDATION_FAILED`.** The contracts' request schemas are strict (T-102 review), and a well-formed body that breaks the contract, including an unknown key, is unprocessable content. Unparseable JSON stays 400 `BAD_REQUEST`. Every error `code` comes from the contracts `ErrorCode` catalogue.
9. **`roles.is_owner`** marks the tenant's single Owner role (partial unique index; it must be a system role and stores no permissions). Nothing depends on the role's name, which T-105 may allow to be translated or renamed.

## Consequences

- Platform code never writes SQL for another module's tables, and the lint boundary on `platform-db` still holds.
- A disabled user, membership or tenant can keep using an access token for at most 60 seconds, unless the change calls the invalidation hook. A refresh always sees the change at once.
- Every role, membership, branch-scope or status change (T-105) must call the `AccessCache` hooks after its transaction commits.
- Concurrent refreshes of one token end the session. The web (T-150) must serialise refreshes (one in-flight refresh shared by all callers).
