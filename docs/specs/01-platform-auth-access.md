# Spec 01 — Platform, authentication & access control

BRD refs: MS-01, §8 (roles), §10 (security), PL-04. ADRs: 0003, 0006, 0007, 0008.

## 1. Data model

### Platform tables (no tenant RLS; accessed via `ekaro_platform`)

**tenants**

| column                 | type        | notes                                                         |
| ---------------------- | ----------- | ------------------------------------------------------------- |
| id                     | uuid pk     | uuidv7                                                        |
| slug                   | text unique | url-safe, derived from trade name, used in UI only            |
| status                 | text        | `trial \| active \| suspended \| closed`                      |
| plan                   | text        | `starter \| growth \| pro` (trial = growth features, BRD §12) |
| trial_ends_at          | timestamptz | signup + 14 days                                              |
| created_at, updated_at | timestamptz |                                                               |

**users**

| column                                | type             | notes                                                          |
| ------------------------------------- | ---------------- | -------------------------------------------------------------- |
| id                                    | uuid pk          |                                                                |
| email                                 | citext unique    | lowercased, trimmed                                            |
| mobile                                | text             | E.164 `+91XXXXXXXXXX`, not unique (shared office phones exist) |
| full_name                             | text             | 1–120 chars                                                    |
| password_hash                         | text null        | bcrypt cost 12; null for Google-only users                     |
| email_verified_at                     | timestamptz null |                                                                |
| totp_secret_enc                       | text null        | AES-256-GCM with key from env                                  |
| status                                | text             | `active \| disabled`                                           |
| failed_login_count, locked_until      | int, timestamptz | progressive lockout: 5 fails → 15 min                          |
| last_login_at, created_at, updated_at | timestamptz      |                                                                |

**refresh_tokens**: id, user_id, membership_id, family_id, token_hash (sha256, unique), expires_at, revoked_at, revoked_reason, replaced_by_id, ip, user_agent, created_at.

### Tenant tables (RLS)

**roles**: id, tenant_id, name (unique per tenant, case-insensitive), description, permissions `text[]` (validated against the catalogue), is_system (seeded templates: permissions cannot be edited for `Owner`), is_billable, plus the standard audit columns and version.

**memberships**: id, tenant_id, user_id, role_id, all_branches bool default true, status `invited | active | disabled`, invited_by, joined_at, plus the standard audit columns and version. Unique (tenant_id, user_id).

**membership_branches**: tenant_id, membership_id, branch_id. Primary key (membership_id, branch_id).

**invitations**: id, tenant_id, email, role_id, all_branches, branch_ids uuid[], token_hash, expires_at (7 days), accepted_at, revoked_at, plus the standard audit columns.

**audit_log**: see ADR 0008. It is partitioned by month on `changed_at`.

## 2. Permission catalogue (Sprint 1 slice)

Format `<module>.<resource>:<action>`. It lives in `packages/contracts/src/access/permissions.ts` as a `const` tuple, and a `Permission` type is derived from it.

```
access.user:view|create|edit|delete        access.role:view|create|edit|delete
audit.log:view
masters.company:view|edit                  masters.branch:view|create|edit|delete
masters.godown:view|create|edit|delete     masters.unit:view|create|edit|delete
masters.tax_rate:view|create|edit|delete   masters.item_category:view|create|edit|delete
masters.item:view|create|edit|delete|export
masters.item_tax_rate:view|create
masters.party:view|create|edit|delete|export
masters.series:view|create|edit
platform.billing:view|edit
```

`masters.item_tax_rate` is a **deliberate addition** to the original Sprint-1 slice (T-102 review). Tax-rate slabs are immutable in their rates (spec 02), so a GST rate change is made by creating a new slab (`masters.tax_rate:create`) and adding an effective-dated row to the item (`POST /items/:id/tax-rates`, `masters.item_tax_rate:create`). Viewing an item's rate history needs `masters.item_tax_rate:view`.

Later sprints extend the catalogue (inventory._, purchase._, sales._, production._, accounts._, gst._, reports.*).

### Default roles (BRD §8.1), seeded per tenant

| Role       | Billable | Sprint-1 permissions                                                                                          |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Owner      | yes      | all (always all, including future permissions: computed, not stored)                                          |
| Admin      | yes      | all except `platform.billing:*`                                                                               |
| Accountant | yes      | view all masters; edit company, parties, series; create and edit tax rates; create item tax rates; audit view |
| Purchase   | yes      | items/parties view, create and edit (vendors); units/categories view                                          |
| Sales      | yes      | items view; parties view, create and edit (customers)                                                         |
| Store      | yes      | items, units, godowns view                                                                                    |
| Production | yes      | items view, create and edit; units view                                                                       |
| CA         | **no**   | view on all masters (item tax rates included), export, audit view                                             |
| Viewer     | **no**   | view on all masters (item tax rates included)                                                                 |

"View all masters" is every `masters.*:view`, so it includes `masters.item_tax_rate:view`. Admin has everything except billing, so it can view and create item tax rates. Accountant's `masters.tax_rate:create` and `masters.item_tax_rate:create` are the deliberate deviation above: the Accountant is the role that changes GST rates.

## 3. Flows & rules

### 3.1 Sign up (MS-01, BRD §13.1)

`POST /api/v1/auth/signup` `{ fullName, email, mobile, password, gstin, acceptTerms: true }`

1. Validate: the GSTIN format and checksum (`@ekaro/core/gstin`), email not registered (409 `EMAIL_TAKEN`), password policy.
2. `GspProvider.lookupGstin(gstin)` returns legal name, trade name, address, state code and status. If the GSTIN is not `Active` → 422 `GSTIN_INACTIVE`. The mock adapter returns deterministic data.
3. One platform transaction: create the user, then the tenant (trial, 14 days), then the tenant bootstrap (with `app.tenant_id` set): company profile, head-office branch (from GSTIN address), "Main" godown, 9 system roles, the UQC units, the GST tax-rate slabs, default document series for the current FY, and an Owner membership.
4. Returns 201 with `{ accessToken, user, tenant, membership }` and sets the refresh cookie.

`GET /api/v1/platform/gstin/:gstin` is public and rate limited to 10 per minute per IP. It returns the lookup for form auto-fill.

### 3.2 Login / session

- `POST /auth/login {email, password, tenantId?}`. On success: if the user has 1 active membership, log into it. If there are more and no `tenantId` was given, return `{ requiresTenantSelection: true, tenants: [...] , selectionToken }` (5-minute signed token), then `POST /auth/select-tenant`.
- `POST /auth/refresh` (cookie) rotates the token. Reuse of a revoked token revokes the family and returns 401 `REFRESH_REUSED`.
- `POST /auth/logout` revokes the family and clears the cookie. `POST /auth/switch-tenant {tenantId}` issues new tokens for another membership.
- `GET /auth/me` returns user, active tenant, membership, role, effective permissions and branch scope.
- Failed login: the generic 401 `INVALID_CREDENTIALS`, with lockout after 5 failures (423 `ACCOUNT_LOCKED`).

### 3.3 Users & roles (tenant-scoped)

- `GET/POST /users`: POST sends an invitation (email via outbox with a token link). If the email already exists as a user, they get a membership on acceptance. Inviting an email with an open invitation replaces it. `GET /users/:membershipId` reads one.
- `GET /invitations?status=&q=&sort=` (`access.user:view`) and `DELETE /invitations/:id` (revoke, `access.user:delete`). An invitation is `pending`, `expired` (derived), `accepted` or `revoked`.
- `POST /auth/invitations/preview {token}` and `POST /auth/accept-invitation {token, fullName?, password?}` (public). A new email sends a name and password; an existing user sends the token only. Acceptance starts no session (T-105, ADR 0016).
- `PATCH /users/:membershipId {roleId, allBranches, branchIds, status, version}`. Rules: you cannot change your own role, you cannot disable the last active Owner, and only an Owner can assign the Owner role. T-105 adds: you cannot disable yourself, only an Owner changes an Owner's membership, and nobody assigns a role with permissions they do not hold (ADR 0016).
- `GET/POST/PATCH/DELETE /roles`: system roles cannot be deleted, a role in use cannot be deleted (409 `ROLE_IN_USE`), and `POST /roles/:id/clone` clones one. The Owner role's permissions and billing flag cannot be edited. A free (non-billable) role may only view and export (BRD §12).
- The minimum-2-billable-users billing rule (BRD §12) is a billing concern and is not enforced at membership level.

### 3.4 Audit

`GET /audit-logs?table=&rowId=&userId=&action=&from=&to=&cursor=&limit=` is paginated with keyset (`cursor`) pagination and requires `audit.log:view`. `from` is inclusive, `to` exclusive. A `company_profile` row's `rowId` is the tenant id, and a `membership_branches` row's is its membership id.

## 4. Acceptance criteria

- A new signup produces a working tenant with all seeded masters. The owner can call `GET /auth/me` and gets all permissions.
- A user with two memberships can switch tenants, and data never crosses between them (e2e plus raw-SQL RLS test).
- Refresh rotation works. Replaying an old refresh token kills the session family.
- Each role gets exactly the permissions in the table above, and denied routes return 403 `FORBIDDEN`.
- Every insert or update on tenant tables creates an audit_log row with old and new values and the acting user.
