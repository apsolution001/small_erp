---
id: T-104
title: Signup + tenant bootstrap, auth sessions, RBAC guards
status: done
sprint: 1
area: server
depends_on: [T-102, T-103]
spec: docs/specs/01-platform-auth-access.md §1–3.2, docs/adr/0006-authentication.md, docs/adr/0007-authorization-rbac.md, docs/adr/0012-integration-ports.md
---

## Scope

- Tables: users, refresh_tokens (platform), roles, memberships, membership_branches, company_profile, branches, godowns, units, tax_rates, document_series (the minimal tables the bootstrap needs. Their CRUD APIs come in T-106/T-107).
- `GspProvider` port + `MockGspProvider` (deterministic lookup from the GSTIN: the state from its first 2 digits, a legal name derived from the PAN, and `Cancelled` status for GSTINs whose PAN starts with `ZZZZZ`, for tests).
- `TenantBootstrapService` (idempotent seeds per spec 02 §4).
- Auth: signup, login (+ tenant selection), refresh rotation with reuse detection, logout, switch-tenant, me, lockout, and throttling on auth routes (Redis store).
- `JwtAuthGuard` (global) and `PermissionGuard` (global, deny by default, Owner = all). Permissions are cached in Redis for 60 seconds and invalidated on role or membership change.

## Acceptance criteria

- The spec 01 §4 criteria for signup, login, refresh and switch, plus e2e tests for each role's allowed and denied access on a probe route.
- Passwords are bcrypt cost 12, and refresh tokens are stored hashed only.

## Decisions

The architectural ones are in [ADR 0015](../adr/0015-sessions-access-resolution.md). In short:

1. **Platform access to other modules' tables goes through the owning module.** Masters and access expose executor-based functions (`seedTenantMasters`, `findCompanyNames`, `seedSystemRoles`, `ensureOwnerMembership`, `loadMembershipAccess`, `findActiveMembershipsOfUser`). Platform and auth pass the platform connection or the signup transaction (`DbExecutor` / `DbTransaction` in `infra/db/db-executor.ts`). The SQL for a table stays in its module.
2. **One signup transaction** on the platform connection: user → trial tenant (slug from the trade name, a random suffix on collision) → bootstrap (with `app.tenant_id`, `app.user_id` = owner and `app.request_id` set, so every seed passes RLS and is audited as the owner) → first refresh token. `ekaro_platform` has `SELECT, INSERT` on the nine bootstrap tables. On the tables without `platform_read`, `tenant_isolation` limits that SELECT to the tenant in context. Every seed uses `ON CONFLICT DO NOTHING` plus a read-back, so the bootstrap is idempotent (tested by running it twice).
3. **Seeds (spec 02 §4):**
   - The company profile comes from the GSTIN lookup: legal/trade name, GSTIN, PAN and address. `email` and `phone` are the owner's signup email and mobile until edited. `books_begin_date` is the start of the signup date's FY (IST). Valuation defaults to `weighted_average`.
   - Head office: branch `HO` "Head Office" at the registered address with the company GSTIN. The "Main" godown is `MAIN`.
   - The 18 units of spec 02 §4, each coded as its UQC, named with the UQC description. Decimals: 0 for counted units (NOS, PCS, BOX, BAG, SET, PAC, ROL, DOZ), 3 for KGS/TON/LTR, 2 for the rest.
   - Tax rates: Nil Rated, Exempt, 0.25, 1.5, 3, 5, 18 and 40 % active; 12 and 28 % inactive. No non-GST or cess slabs.
   - Series: one default per `DocType` for the head office and current FY, as `<code>/<yy-yy>/`, padding 4, starting at 1. The codes are PR, PO, GRN, PI, DN, QT, SO, DC, SI, CN, ST, SA, WO, MI, PE, JWO, JWI, PMT, RCT, CTR and JV (`DOC_TYPE_SERIES_CODES`). The longest, `JWO/26-27/0001`, is 14 characters.
   - The nine system roles come from `DEFAULT_ROLES`, and the signing-up user gets an active, all-branches Owner membership.
4. **`roles.is_owner`** (an addition to spec 01 §1) marks the single Owner role: a partial unique index, it must be `is_system`, and it stores no permissions. Its effective permissions are the whole catalogue, computed by `effectivePermissions()` (added to contracts). Nothing keys on the role name.
5. **Schema choices:**
   - `users.email` is `citext` and must be stored lower-cased and trimmed. `users.mobile` is nullable (invited users).
   - `users` and `refresh_tokens` have forced RLS with a `platform_all` policy and no grant to `ekaro_app`.
   - Tenant-to-tenant references are composite FKs `(tenant_id, x_id)` → `unique (tenant_id, id)`: memberships → roles, membership_branches → memberships and branches, godowns and document_series → branches. So a row can never point at another tenant's parent, which the isolation test checks.
   - `company_profile` is keyed by `tenant_id`, and `membership_branches` by `(membership_id, branch_id)`. Their audit rows therefore have a NULL `row_id` (the trigger reads `id`).
   - DB check constraints mirror the contracts: GSTIN format and state, PAN matching the GSTIN, pincode, UQC list, rate ranges and flags, and the series rules (upper-case affixes, a prefix starting with a letter or 1–9, width ≤ 16).
6. **Guards:**
   - `JwtAuthGuard` lives in `modules/auth`, not `modules/access`, because it must read the user's status from the platform-only `users` table and `access` may not import the platform connection. `PermissionGuard` lives in `modules/access`. `AppModule` registers them in that order.
   - Routes declare `@Public()`, `@Authenticated()` (new: a session, no specific permission; used by `/auth/me` and `/auth/switch-tenant`) or `@RequirePermission()`. `RequirePermission` now takes the contracts `Permission` type and rejects any string outside the catalogue.
   - A route with no declaration is refused (403, logged). An e2e test lists every route and pins the public ones.
7. **Access cache:** an `AccessSnapshot` (role, effective permissions, branch scope, and membership, user and tenant status) is cached per membership in a Redis hash per tenant for 60 seconds.
   - The hooks are `AccessCache.invalidateMembership()` and `invalidateTenant()`. T-105 must call them.
   - A Redis error falls back to the database. Login, refresh and switch always read fresh.
   - A disabled user gets 401 `ACCOUNT_DISABLED`. A disabled or invited membership gets 403 `FORBIDDEN`. A suspended or closed tenant gets 403 `TENANT_SUSPENDED`.
8. **Sessions:**
   - A session is a refresh-token family, and its id is the access token's `sid`. Tokens are 32 random bytes in base64url, stored as a hex SHA-256 hash. Rotation runs under `SELECT … FOR UPDATE`.
   - **Any** revoked token presented again (rotated, logged out or switched) revokes the family: 401 `REFRESH_REUSED`. There is no grace window for concurrent tabs; the web must serialise refreshes.
   - Refresh sets a new 30-day expiry (sliding). A refresh whose user, membership or tenant lost access revokes the family (`access_revoked`).
   - A failed refresh clears the cookie. Logout is `@Public`, idempotent, and always returns 204 and clears the cookie.
   - Switch-tenant starts a new family for the target membership, then revokes the old one (`switched`). Switching to the current tenant is allowed and simply rotates the session.
9. **Cookie:** `ekaro_refresh=<token>; Path=/api/v1/auth; Expires=<30 days>; HttpOnly; Secure; SameSite=Strict`. `Secure` follows the new env `REFRESH_COOKIE_SECURE` (default true, refused as false in production). `.env.example` sets false for local http.
10. **Login:**
    - An unknown email, a user without a password and a wrong password all give 401 `INVALID_CREDENTIALS` with the same message, and each spends a bcrypt comparison.
    - A locked account gets 423 `ACCOUNT_LOCKED` before the password is checked, and the attempt is not counted. The fifth consecutive failure locks for 15 minutes, returns 423 and resets the counter, in one atomic SQL update. A success resets both.
    - A user with no active membership in a usable tenant gets 403 `FORBIDDEN`.
    - With several memberships and no `tenantId`: 200 `{ requiresTenantSelection, selectionToken, tenants }` and no cookie. The selection token is a 5-minute JWT with its own audience (`<JWT_AUDIENCE>:tenant_selection`), so it is not an access token and vice versa. Choices are ordered by membership age.
11. **Signup:**
    - The email is checked first (409 `EMAIL_TAKEN`; a unique-violation race maps to the same code), then the common-password list (422 `VALIDATION_FAILED` on `password`), then the GSP. A non-`Active` GSTIN gives 422 `GSTIN_INACTIVE`, and a GSP failure gives 503 `SERVICE_UNAVAILABLE`.
    - The tenant is on a 14-day trial of the growth plan.
12. **Mock GSP:**
    - Legal name `<PAN> Private Limited` (holder type C), `<PAN> and Associates` (F) or `<PAN> Enterprises` (others). Trade name `<PAN> Traders`.
    - Address `Unit <PAN digits>, Industrial Estate`, the city is the state name, and the PIN is a zone digit plus the PAN digits plus 0.
    - The status is `Cancelled` for PANs starting `ZZZZZ`, otherwise `Active`.
    - `GSP_PROVIDER` selects the adapter through a typed record, so adding a value to the env enum forces an adapter.
    - The contracts gained `gstinLookupParamsSchema` / `gstinLookupResponseSchema` (current state codes only).
13. **Throttling:**
    - A Redis fixed window (Lua, atomic) behind `@nestjs/throttler`, with named throttlers: `auth-ip` (20/min per IP per auth route), `auth-account` (10/min per email on signup and login) and `gstin-ip` (10/min per IP, spec 01 §3.1). Each limit is configurable (`THROTTLE_*_PER_MINUTE`).
    - Express `trust proxy` = `TRUST_PROXY_HOPS` (default 0: `X-Forwarded-For` ignored). With 1, only the last hop's address counts, and a spoofed left-most entry does not help (tested).
    - e2e runs set the limits very high, because all files share one Redis and one loopback address. The throttling test sets low limits and uses random client IPs.
14. **Errors aligned with contracts:**
    - `DomainError.code` is the contracts `ErrorCode`. The catalogue gained `BAD_REQUEST`, `METHOD_NOT_ALLOWED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` and `SERVICE_UNAVAILABLE` for framework errors. Any other framework 4xx maps to `BAD_REQUEST` (it used to be `HTTP_<status>`). A unique violation is `ALREADY_EXISTS` (it used to be `DUPLICATE_RECORD`). The health check fails with `SERVICE_UNAVAILABLE`.
    - New `LockedError` (423).
    - **`ValidationError` is now 422** (it was 400). The strict contract schemas treat unknown keys as unprocessable content (lead instruction after the T-102 review), and `problemSchema`'s own example uses 422. Unparseable JSON stays 400 `BAD_REQUEST`.
    - Both a unit test and an e2e test parse real error bodies with `problemSchema`.
15. **Fixes to T-103 code found on the way:**
    - `tenantTable()` returned a table type without the standard columns: the `never` guard on the parameter erased them. The return type is now stated explicitly, with a type-level test.
    - The shared `inList`/`checks.ts` helpers and `pg-errors.ts` replace the private copies.
    - `@nestjs/config` was removed.
16. **Local environment note:** the repo `.env` could not be edited in this session (permission rule), so the e2e runs used `TEST_DB_NAME=ekaro_t104_test` on the command line, and migrations used `DATABASE_URL_OWNER=…/ekaro_t104`.

## Plan

- [x] Contracts: framework error codes, `effectivePermissions`, `platform/gstin.ts`
- [x] API errors aligned with `ErrorCode`/`problemSchema`; `RequirePermission(Permission)`; `@Authenticated()`; `LockedError`; 422 validation; remove `@nestjs/config`
- [x] Schemas + migrations `0003_auth_access_masters` (generated) and `0004_auth_access_masters_security` (RLS, grants, platform_read)
- [x] Masters seed builders + `seedTenantMasters`, access seeds and membership queries (+ unit specs)
- [x] Platform: `GspProvider` + `MockGspProvider`, `GET /platform/gstin/:gstin`, `TenantsService`, `TenantBootstrapService`
- [x] Access: `AccessCache`, `PermissionGuard` (+ spec); throttling module with Redis storage; env settings
- [x] Auth: password hashing and common-password check, access/selection tokens, refresh tokens and sessions, users repository with lockout, `SessionAccessLoader`, `AuthService`, `AuthController`, `JwtAuthGuard` (+ specs)
- [x] e2e: signup, sessions, lockout, throttling, role × permission matrix and route audit, isolation of every new tenant table; migration test extended
- [x] ADR 0015, task board

## Verification

Run on 2026-09-26 against local Postgres 16.13 + Redis 7.0.15, test DB `ekaro_t104_test`, after merging `claude/brave-dirac-k9ikzp` (T-101/T-102 review fixes).

- `pnpm format` then `pnpm format:check`: clean.
- `pnpm lint`: 4/4 tasks successful. `pnpm typecheck`: 4/4 successful. `pnpm build`: 4/4 successful.
- `pnpm test`: core **127**, contracts **291** (100% coverage kept), web **1**, api **116** tests passed (api: 20 files, including the new specs for tokens, refresh-token rules, session rules and lockout, passwords, the permission guard, mock GSP, slugs, seed builders, role seeds, pg errors and env).
- `pnpm --filter @ekaro/api test:e2e`: **11 files, 137 tests passed**:
  - `auth/signup.e2e-spec.ts` (17):
    - The session, trial and Owner membership; the cookie attributes and 30-day expiry.
    - bcrypt `$2b$12$`, and the refresh token stored only as its SHA-256.
    - Company profile, HO branch, Main godown, 9 roles, 18 units and 10 slabs seeded exactly.
    - 21 series with `SI/<fy>/0001` and `PO/<fy>/0001`; every seeded row audited with the owner as `changed_by`.
    - `/auth/me` with every permission; a second bootstrap adds nothing.
    - 409 `EMAIL_TAKEN` (any case); 422 `GSTIN_INACTIVE` creating nothing; 422 for a bad checksum, a common password, unaccepted terms and an unknown key.
    - The GSTIN lookup is public, and a bad checksum gives 422.
  - `auth/sessions.e2e-spec.ts` (16):
    - Single-tenant login; identical 401 for a wrong password and an unknown email.
    - Two memberships → selection → select-tenant; direct `tenantId`; 403 for a foreign tenant; 401 for a forged selection token.
    - Refresh rotation (old row `rotated` with `replaced_by_id`); replaying the old token → 401 `REFRESH_REUSED`, the current token dies too, and the cookie is cleared.
    - 401 with no cookie, an unknown token or an expired one.
    - Logout revokes the family and clears the cookie, and is idempotent.
    - switch-tenant moves to the Viewer membership and revokes the old family (`switched`); 403 for a foreign tenant, 401 without a session.
    - `/auth/me` shape; 401 `UNAUTHENTICATED`, `TOKEN_INVALID` and `TOKEN_EXPIRED`.
    - A disabled membership passes from cache, then gets 403 after `invalidateMembership`, and its refresh is refused with the family `access_revoked`. A disabled user gets 401 `ACCOUNT_DISABLED` on requests and on login.
  - `auth/lockout.e2e-spec.ts` (4): failures counted and reset on success; the fifth failure → 423 with a ~15-minute lock; the right password is refused while locked and not counted; login works after expiry.
  - `auth/throttling.e2e-spec.ts` (4): GSTIN per IP (429 `RATE_LIMITED` problem, `Retry-After-gstin-ip`); only the trusted hop counts; login per email across IPs; each auth route per IP across emails.
  - `access/permissions.e2e-spec.ts` (21): for each of the 9 roles, `/auth/me` permissions equal `effectivePermissions(default role)`, and all 48 probe routes (one per catalogue permission) return 200 exactly for granted permissions and 403 `FORBIDDEN` otherwise. An undeclared route is 403 even for the Owner; no session gives 401. Every real route declares access, and the public set is pinned.
  - `tenancy/isolation.e2e-spec.ts` (31):
    - Each of the 9 tables has forced RLS, the expected policies (`platform_read` only on roles/memberships/membership_branches/company_profile) and the audit trigger.
    - B's context sees none of A's rows, and no context sees nothing. B's update/delete of A's rows affects 0 rows. A foreign insert is rejected by RLS, and a composite FK blocks pointing at A's branch.
    - `ekaro_app` is denied `users` and `refresh_tokens`. `ekaro_platform` reads memberships across tenants but units only in context, and cannot delete.
  - Existing suites still green: `db/migrations` (3, now asserting that all 13 tables have forced RLS), `tenancy/rls` (19), `tenancy/tenant-tx` (8), `http-pipeline` (12, with `problemSchema` parsing real 422/400/409/404/500 bodies) and `health` (2).
- `db:migrate` on a fresh `ekaro_t104`: `migrations applied`.
- Review: the `code-reviewer` agent could not be invoked from this sub-agent session (no agent tool). A self-review against the backend, database, security and testing standards was done instead. Run `code-reviewer` on this branch before merging.

## Follow-ups

- **T-105:**
  - Call `AccessCache.invalidateMembership()` after any membership role, branch or status change (and when disabling a user, per tenant), and `invalidateTenant()` after a role permission change, in each case after commit.
  - Enforce "Owner role immutable" with `roles.is_owner`.
  - The users list needs names and emails from `users`, which is platform-only. Decide the read path (an owning-module query on the platform connection, or a narrow view for `ekaro_app`).
  - Accept-invitation creates users (`users.mobile` is nullable for that).
  - The audit query should know that `company_profile` and `membership_branches` rows have a NULL `row_id`.
- **T-106/T-107:** CRUD on the seeded tables. The DB already enforces the check constraints listed in Decision 5, and the seed builders show the canonical defaults. Company PATCH must keep `books_begin_date`/`valuation_method` locks (spec 02). Tax-rate slabs are immutable in their rates (contracts). Consider a DB trigger to enforce that too. Series services must honour the spec 02 "fixed once issued" and per-GSTIN uniqueness rules.
- **T-108:** nothing specific.
- **T-150 (web), the auth contract:**
  - `POST /api/v1/auth/signup` `{fullName, email, mobile, password, gstin, acceptTerms: true}` → **201** `TokenResponse` + cookie. Errors: 409 `EMAIL_TAKEN`, 422 `GSTIN_INACTIVE`, 422 `VALIDATION_FAILED` (`errors[].path`, including `password` with code `too_common`), 429 `RATE_LIMITED`, 503 `SERVICE_UNAVAILABLE`.
  - `GET /api/v1/platform/gstin/:gstin` (public, 10/min/IP) → `GstinLookupResponse` for auto-fill (it returns `Cancelled` registrations too; signup refuses them).
  - `POST /api/v1/auth/login` `{email, password, tenantId?}` → **200** either `TokenResponse` + cookie, or `TenantSelectionResponse` `{requiresTenantSelection: true, selectionToken, tenants: [{tenantId, name, slug, roleName}]}` with no cookie. Errors: 401 `INVALID_CREDENTIALS`, 401 `ACCOUNT_DISABLED`, 423 `ACCOUNT_LOCKED`, 403 `FORBIDDEN` (no company, or not a member of `tenantId`), 429.
  - `POST /api/v1/auth/select-tenant` `{selectionToken, tenantId}` → 200 `TokenResponse` + cookie. The token expires after 5 minutes (401 `TOKEN_EXPIRED`); send the user back to login.
  - `POST /api/v1/auth/refresh` (no body; cookie) → 200 `TokenResponse` + new cookie. Any 401 (`UNAUTHENTICATED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `REFRESH_REUSED`, `ACCOUNT_DISABLED`) or 403 clears the cookie: go to login. **Serialise refreshes**: concurrent refreshes with one cookie end the session.
  - `POST /api/v1/auth/logout` (cookie) → 204, cookie cleared. It works with an expired access token.
  - `POST /api/v1/auth/switch-tenant` `{tenantId}` with `Authorization: Bearer` → 200 `TokenResponse` + new cookie. The previous session is ended. Reset all tenant-scoped query caches.
  - `GET /api/v1/auth/me` (Bearer) → `MeResponse` `{ user: {id, email, fullName, mobile}, tenant: {id, slug, name, status, plan, trialEndsAt}, membership: {id, role: {id, name}, allBranches, branchIds, status}, permissions: Permission[] (catalogue order; all for Owner) }`. Drive `useCan()` from `permissions`.
  - The access token lives in memory only (15 minutes; claims `sub, tid, mid, sid, iss, aud`). The cookie `ekaro_refresh` is `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, with `Secure` except local http (`REFRESH_COOKIE_SECURE=false`). Use `credentials: 'include'` on the auth calls; the API's CORS allows `APP_ORIGIN` with credentials.
  - Validation errors are **422** `VALIDATION_FAILED` with `errors[{path, message, code}]`; malformed JSON is 400 `BAD_REQUEST`.
- **Ops:** set `TRUST_PROXY_HOPS` to the number of proxies in front of the API (1 behind a single load balancer), and `REFRESH_COOKIE_SECURE=true` (enforced in production).
- **Security hardening (later):** JWT key rotation by `kid` (security standard) is not implemented; there is a single `JWT_ACCESS_SECRET`. A session list and "sign out everywhere" can use the `refresh_tokens` metadata (IP, user agent). Checking the session table on sensitive routes (ADR 0006) is for T-105 user management and billing.
