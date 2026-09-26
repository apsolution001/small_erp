---
id: T-102
title: '@ekaro/contracts: common, permissions, auth, access, masters schemas'
status: done
sprint: 1
area: shared
depends_on: [T-101]
spec: docs/adr/0013-shared-contracts.md, docs/specs/01-platform-auth-access.md, docs/specs/02-masters.md
---

## Scope

- `common`: `uuidSchema`, `moneySchema` (paise string ↔ validated `^-?\d+$`), `qtySchema`/`rateSchema` (decimal string with ≤ 6 dp), `percentSchema`, `gstinSchema` (uses core), `stateCodeSchema`, `pincodeSchema`, `phoneSchema` (E.164 +91), `paginationQuerySchema`, `paginated(schema)`, `problemSchema`, the `ErrorCode` enum.
- `access`: the `PERMISSIONS` const catalogue (spec 01 §2), the `Permission` type, `DEFAULT_ROLES` (name, billable, permissions) and `hasPermission`.
- `auth`: signup, login, select-tenant, switch-tenant, me, invitation-accept, and the token response.
- `access` DTOs: user (membership) list/invite/update, role CRUD/clone.
- `masters`: company, branch, godown, unit, taxRate, itemCategory, item (+units, tax rates), party (+addresses), documentSeries, with create/update/list/response schemas as in spec 02, and the `DocType` enum.

## Acceptance criteria

- Everything is exported from the package root and typechecks in both apps. Unit tests cover the tricky refinements (GSTIN state vs address state, track_expiry requires track_batches, series length).

## Plan

- [x] `common/`: `primitives.ts`, `pagination.ts`, `errors.ts` (ErrorCode + problem).
- [x] `access/`: `permissions.ts` (catalogue, default roles, `hasPermission`), `users.ts` (memberships, invitations), `roles.ts`.
- [x] `auth/auth.ts`.
- [x] `masters/`: `company`, `branch`, `godown`, `unit`, `tax-rate`, `item-category`, `item`, `party`, `document-series`, `doc-types`, `shared` (address shape, GSTIN consistency).
- [x] `index.test.ts`: root exports, and `z.toJSONSchema` for every exported schema (ADR 0013).
- [x] Coverage gate at 95% in `vitest.config.ts`.

## Decisions

1. **Schema set per entity.** Each master has `<entity>ResponseSchema`, `<entity>CreateSchema`, `<entity>UpdateSchema` and `<entity>ListQuerySchema`, with inferred types (`XResponse`, `XCreate`, `XCreateInput` = `z.input`, `XUpdate`, `XListQuery`). Exceptions: **company** has no list query (one row per tenant), and its create schema serves the signup bootstrap rather than an HTTP route. The item category also has `itemCategoryTreeNodeSchema` for `?tree=true`, and items have `itemTaxRateCreateSchema` / `itemTaxRateResponseSchema`.
2. **Update = PATCH without defaults.** Zod 4's `.partial()` still applies inner `.default()`s, so a PATCH built from the create schema would silently reset omitted fields. It also throws on refined objects. So each entity has a plain field shape. Create adds the defaults and the rules, and Update is `partial()` of the plain shape plus `version`, with the same rules. Nested arrays (`units`, `addresses`) are replaced as a whole when sent. `version` is required on every update (optimistic locking).
3. **Cross-field rules run only when their fields are present.** On a create every field is present, so every rule runs. On a PATCH a rule runs only if the patch carries the fields it compares. **The services (T-104–T-108) must re-check the merged record**, and this is noted in each rule's doc comment. Zod 4 does not run object-level rules while a field-level error exists, so a user sees cross-field errors only after the fields themselves are valid.
4. **Money** is a paise string `^-?\d+$`, bounded to the Postgres `bigint` range so an out-of-range value is a 422 and never a DB error. `nonNegativeMoneySchema` is used for credit limits. **Qty/rate** are decimal strings that fit `numeric(20,6)` (≤ 14 integer digits, ≤ 6 dp), and the string is preserved exactly (`"50.000000"` round-trips). Rates are non-negative. **Percent** is `numeric(7,4)` (0–999.9999, since cess can exceed 100%), and the tax-rate schema caps the GST rate at 100.
5. **No transforms to `Money`/`Decimal` inside schemas.** Schemas carry strings in and out, so they stay JSON-serialisable and convertible with `z.toJSONSchema` in both `input` and `output` mode (tested for every exported schema). Callers use `Money.parse`, `parseQty` and so on from `@ekaro/core`.
6. **Normalisation** inside schemas: GSTIN and PAN are trimmed and upper-cased, emails are trimmed and lower-cased, unit codes are upper-cased, and text fields are trimmed (`text(max)`: 1..max characters). Phone numbers are strict E.164 `+91` (the web normalises user input). `mobileSchema` requires a 6–9 leading digit, while `phoneSchema` also accepts landlines. Empty optional fields are sent as `null`, not `''`.
7. **Permissions and default roles follow spec 01 §2 literally.** Where the spec says "edit" for Accountant (tax rates, parties, series), only `:edit` is granted, not `:create`. The spec says "create" explicitly when it means it (Purchase, Sales, Production), and owners can clone and extend roles. "View all masters" is every `masters.*:view`. Purchase's "(vendors)" and Sales' "(customers)" restrictions cannot be expressed in `<module>.<resource>:<action>` permissions, so in Sprint 1 they grant party access without a type filter. A party-type scope is a follow-up if the business wants it. **Owner** has `allPermissions: true` and `permissions = PERMISSIONS`: it is computed and never stored, so future permissions are included automatically.
8. **Password policy:** at least 10 characters and at most **72 UTF-8 bytes**, because bcrypt silently ignores anything after byte 72. The common-password check stays in the API. Login does not apply the policy, so that old passwords keep working. `accept-invitation` requires `fullName` and `password` together or not at all (new user vs existing user).
9. **Token responses** follow spec 01 (`{ accessToken, user, tenant, membership }`). The refresh token is only ever in the httpOnly cookie. `loginResponseSchema` is the union of that response and the tenant-selection response. `me` carries the membership (role and branch scope) and the effective permissions.
10. **ErrorCode** is a `z.enum` with enum-style access (`ErrorCode.NOT_FOUND`). It holds the codes the specs name, plus the codes needed for the business rules in spec 01 §3.3 and spec 02 §3 (`SELF_ROLE_CHANGE`, `LAST_OWNER`, `OWNER_ASSIGNMENT_FORBIDDEN`, `SYSTEM_ROLE_IMMUTABLE`, `HEAD_OFFICE_REQUIRED`, `BRANCH_HAS_ACTIVE_GODOWNS`, `VALUATION_METHOD_LOCKED`, `SERIES_NUMBER_DECREASE`, …). `INVALID_TRANSITION` matches `InvalidTransitionError.code` from core. The problem's `errors[].path` is a dotted path (`addresses.0.pincode`), as react-hook-form expects.
11. **Company defaults:** `valuationMethod` is `weighted_average` (Tally's default "Avg. Cost"; editable until the first stock posting). The other defaults come from spec 02: no negative stock, sales round-off on, 4 HSN digits, e-invoice off. The company's `state_code` and its address `state_code` in spec 02 are the same value, so they are one `stateCode` field. The address fields are flat (`line1`, `line2`, `city`, `pincode`, `stateCode`) on the company and on branches.
12. **GSTIN consistency** (company, branch, party) checks both the state code and, when a PAN is given, that the PAN equals characters 3–12 of the GSTIN. For a party, the state compared is the **default billing address** state.
13. **Parties:** a GSTIN is required for `regular`, `composition` and `sez`, and must be null for `unregistered`, `consumer` and `overseas`. Exactly one default billing address is required, so a create needs at least one address, and at most one default shipping address is allowed. Addresses have `country` (ISO alpha-2, default `IN`). An Indian address needs a state and a 6-digit pincode, while a foreign one (overseas parties) has no state and a free-form postcode (≤ 10). On update, an address may carry its `id` so the service can keep it rather than recreate it. The credit limit field is `creditLimitPaise` (from `credit_limit_paise`): null means no limit and `"0"` means cash only.
14. **Items:** `trackExpiry ⇒ trackBatches`. `itemType = service ⇔ itemKind = service`, and services cannot track batches. The HSN has 4, 6 or 8 digits for goods, and the SAC has 6 digits starting with `99` for services. The `company.hsnMinDigits` check needs the company, so it stays in the service. UoM conversions have a positive factor, each unit appears once, and the base unit is never listed. Purchase and sales units must be the base unit or a converted unit. `itemCreateSchema.taxRateId` (required) is the initial rate, which the service stores with `effectiveFrom` = books-begin date. The response includes `units` and the effective-dated `taxRates`.
15. **Tax rates:** exempt, nil-rated and non-GST are mutually exclusive, and such a slab must have a zero GST and cess rate.
16. **Document series:** `nextNumber` is a positive integer **string** (`next_number` is `bigint`, and a 16-digit number exceeds `Number.MAX_SAFE_INTEGER`). The prefix (≤ 10) and suffix (≤ 6) use `[A-Za-z0-9/-]`. The 16-character width rule reuses `validateSeries` from core, so the API, the web and allocation share one implementation. On update, the width check runs when prefix, suffix and padding are all sent. `branchId`, `docType` and `fy` identify the series and cannot be updated.
17. **List filters:** `?active=` uses `z.stringbool()`, because `z.coerce.boolean()` would read `"false"` as true. Pagination coerces `page` and `pageSize` (defaults 1/25, max 200) and validates `sort` as `field:asc|desc`.
18. **Gate:** contracts also got a 95% coverage threshold, matching core.

## Verification

Run at the repo root on 2026-09-26:

- `pnpm --filter @ekaro/core --filter @ekaro/contracts run build`: both built.
- `pnpm lint --force`: 4/4 tasks successful. `pnpm typecheck --force`: 4/4 successful. `pnpm build --force`: 4/4 successful. `pnpm format:check`: clean.
- `pnpm test --force`: 4/4 tasks successful. `@ekaro/contracts`: **10 files, 215 tests passed**, with **100%** statements (275/275), branches (121/121), functions (39/39) and lines (256/256). `@ekaro/core`: 106 passed. `@ekaro/api`: 1 passed. `@ekaro/web`: 1 passed.
- Both apps: the apps do not import the contracts yet, and `apps/**` was out of scope. A probe file importing `@ekaro/core` and `@ekaro/contracts` (schemas, types, `ErrorCode`, `DEFAULT_ROLES`, `hasPermission`, `splitTax`, …) was type-checked with `tsc` using `apps/api/tsconfig.json` and `apps/web/tsconfig.json` as the base configs, with each app's own `node_modules`. Both passed.
- Refinement tests: GSTIN state vs company, branch and default billing state, and PAN vs GSTIN; `trackExpiry` needs `trackBatches` (create and update); the series 16-character width through padding and through the next number; GSTIN required or forbidden by registration type; default-address counts; Indian vs foreign addresses; HSN/SAC shape; UoM conversions; tax-rate flags; branch scope on invitations. `z.toJSONSchema` succeeds for every exported schema in both input and output mode.
- Review: the `code-reviewer` and `accounting-reviewer` agents could not be spawned from the implementing session, which has no sub-agent tool. The change was self-reviewed against their checklists. Running both agents before merge is a follow-up.
