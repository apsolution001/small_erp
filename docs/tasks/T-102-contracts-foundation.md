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
- `access` DTOs: user (membership joined with its user) list/invite/update, role CRUD/clone.
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

1. **Schema set per entity.** Each master has `<entity>ResponseSchema`, `<entity>CreateSchema`, `<entity>UpdateSchema` and `<entity>ListQuerySchema`, with inferred types (`XResponse`, `XCreate`, `XCreateInput` = `z.input`, `XUpdate`, `XListQuery`). Every entity with cross-field rules also has `<entity>RecordSchema` (Decision 3): company, branch, tax rate, item, party, document series and user. Exceptions: **company** has no list query (one row per tenant), and its create schema serves the signup bootstrap rather than an HTTP route. The item category also has `itemCategoryTreeNodeSchema` for `?tree=true`, and items have `itemTaxRateCreateSchema` / `itemTaxRateResponseSchema`.
2. **Update = PATCH without defaults.** Zod 4's `.partial()` still applies inner `.default()`s, so a PATCH built from the create schema would silently reset omitted fields. It also throws on refined objects. So each entity has a plain field shape. Create adds the defaults and the rules, and Update is `updateSchema(fields)` from `common/update.ts`: `strictObject(fields).partial()` plus `version`, with **at least one field to change** (a body with only `version` is a 422). Nested arrays (`units`, `addresses`) are replaced as a whole when sent. `version` is required on every update (optimistic locking).
3. **Cross-field rules run on whole records: `xRecordSchema = z.object(xFields).superRefine(xRules)`.** The rules take `z.output<typeof xRecordObject>` (every field present), so no rule has an "only when present" branch. A create runs them directly (every field is present after defaults). An update schema checks fields only; the service (T-104–T-108) then runs **`xRecordSchema.parse({ ...existing, ...patch })`** before saving, so a patch that is valid alone but breaks a rule once merged (for example `{ stateCode: '29' }` on a company with a Maharashtra GSTIN) is a 422. Record schemas are not strict, so the stored row's `id`, `version` and timestamps are stripped. There is one test per entity for this. Zod 4 does not run object-level rules while a field-level error exists, so a user sees cross-field errors only after the fields themselves are valid.
4. **Money** is a paise string (`PAISE_PATTERN` from core), bounded to the Postgres `bigint` range so an out-of-range value is a 422 and never a DB error. `nonNegativeMoneySchema` is used for credit limits. **Qty/rate** are decimal strings that fit `numeric(20,6)` (`QTY_PATTERN` / `RATE_PATTERN` from core: ≤ 14 integer digits, ≤ 6 dp), and the string is preserved exactly (`"50.000000"` round-trips). Rates are non-negative. **Percent** is `numeric(7,4)` (0–999.9999, since cess can exceed 100%), and the tax-rate schema caps the GST rate at 100.
5. **No transforms to `Money`/`Decimal` inside schemas.** Schemas carry strings in and out, so they stay JSON-serialisable and convertible with `z.toJSONSchema` in both `input` and `output` mode (tested for every exported schema). Callers use `Money.parse`, `parseQty` and so on from `@ekaro/core`.
6. **Normalisation** inside request schemas: GSTIN and PAN are trimmed and upper-cased, emails are trimmed and lower-cased, unit codes and series prefixes and suffixes are upper-cased, and text fields are trimmed (`text(max)`: 1..max characters). Phone numbers are strict E.164 `+91` (the web normalises user input). `mobileSchema` requires a 6–9 leading digit, while `phoneSchema` also accepts landlines. Empty optional fields are sent as `null`, not `''`.
7. **Permissions and default roles follow spec 01 §2**, with one deliberate, documented deviation: `masters.item_tax_rate:view|create` was added, and Accountant has `masters.tax_rate:create` and `masters.item_tax_rate:create` (Decision 15). Otherwise, where the spec says "edit" for Accountant (parties, series), only `:edit` is granted, not `:create`. The spec says "create" explicitly when it means it (Purchase, Sales, Production), and owners can clone and extend roles. "View all masters" is every `masters.*:view`. Purchase's "(vendors)" and Sales' "(customers)" restrictions cannot be expressed in `<module>.<resource>:<action>` permissions, so in Sprint 1 they grant party access without a type filter. A party-type scope is a follow-up if the business wants it. **Owner** has `allPermissions: true` and `permissions = PERMISSIONS`: it is computed and never stored, so future permissions are included automatically.
8. **Password policy:** at least 10 characters and at most **72 UTF-8 bytes**, because bcrypt silently ignores anything after byte 72. The common-password check stays in the API. Login does not apply the policy, so that old passwords keep working. `accept-invitation` requires `fullName` and `password` together or not at all (new user vs existing user).
9. **Token responses** follow spec 01 (`{ accessToken, user, tenant, membership }`). The refresh token is only ever in the httpOnly cookie. `loginResponseSchema` is the union of that response and the tenant-selection response. `me` carries the membership (role and branch scope) and the effective permissions.
10. **ErrorCode** is a `z.enum` with enum-style access (`ErrorCode.NOT_FOUND`). It holds the codes the specs name, plus the codes needed for the business rules in spec 01 §3.3 and spec 02 §3 (`SELF_ROLE_CHANGE`, `LAST_OWNER`, `OWNER_ASSIGNMENT_FORBIDDEN`, `SYSTEM_ROLE_IMMUTABLE`, `HEAD_OFFICE_REQUIRED`, `BRANCH_HAS_ACTIVE_GODOWNS`, `VALUATION_METHOD_LOCKED`, `SERIES_NUMBER_DECREASE`, …). `INVALID_TRANSITION` matches `InvalidTransitionError.code` from core. The problem's `errors[].path` is a dotted path (`addresses.0.pincode`), as react-hook-form expects.
11. **Company defaults:** `valuationMethod` is `weighted_average` (Tally's default "Avg. Cost"; editable until the first stock posting). The other defaults come from spec 02: no negative stock, sales round-off on, 4 HSN digits, e-invoice off. The company's `state_code` and its address `state_code` in spec 02 are the same value, so they are one `stateCode` field. The address fields are flat (`line1`, `line2`, `city`, `pincode`, `stateCode`) on the company and on branches.
12. **GSTIN consistency** (company, branch, party) checks both the state code and, when a PAN is given, that the PAN equals characters 3–12 of the GSTIN. For a party, the state compared is the **default billing address** state.
13. **Parties:** a GSTIN is required for `regular`, `composition` and `sez`, and must be null for `unregistered`, `consumer` and `overseas`. Exactly one default billing address is required, so a create needs at least one address, and at most one default shipping address is allowed. Addresses have `country` (ISO alpha-2, default `IN`). An Indian address needs a state and a 6-digit pincode, while a foreign one (overseas parties) has no state and a free-form postcode (≤ 10). On update, an address may carry its `id` so the service can keep it rather than recreate it. The credit limit field is `creditLimit` (column `credit_limit`, paise): money fields carry no unit suffix, because the paise-string type conveys it. Null means no limit and `"0"` means cash only. Addresses use current state codes only.
14. **Items:** `trackExpiry ⇒ trackBatches`. `itemType = service ⇔ itemKind = service`, and services cannot track batches. The HSN has 4, 6 or 8 digits for goods, and the SAC has 6 digits starting with `99` for services. The `company.hsnMinDigits` check needs the company, so it stays in the service. UoM conversions have a positive factor, each unit appears once, and the base unit is never listed. Purchase and sales units must be the base unit or a converted unit. `itemCreateSchema.taxRateId` (required) is the initial rate, which the service stores with `effectiveFrom` = books-begin date. The response includes `units` and the effective-dated `taxRates`.
15. **Tax rates:** exempt, nil-rated and non-GST are mutually exclusive, and such a slab must have a zero GST and cess rate. **A slab is immutable in its rate fields:** `taxRateUpdateSchema` accepts only `name`, `isActive` and `version`. A rate change is a new slab plus an effective-dated `item_tax_rates` row (`itemTaxRateCreateSchema`, permission `masters.item_tax_rate:create`), so documents dated before the change keep the old rate. Recorded as a deviation in spec 01 §2 and spec 02.
16. **Document series:** `nextNumber` is a positive integer **string** (`next_number` is `bigint`, and a 16-digit number exceeds `Number.MAX_SAFE_INTEGER`). The prefix (≤ 10) and suffix (≤ 6) use `[A-Za-z0-9/-]` and are upper-cased on input. The prefix must start with `[A-Za-z1-9]`, and a series without a prefix must not render a leading zero (e-invoice). The width rule (the widest number from `nextNumber` on, ≤ 16) and the first-character rule reuse `validateSeries` from core, so the API, the web and allocation share one implementation; on update they run on the merged record (Decision 3). `branchId`, `docType` and `fy` identify the series; the strict update schema rejects them. Spec 02 records the T-106 service rules: numbering fields change only while the series has issued nothing, and the rendered number is unique per (GSTIN, document family, FY).
17. **List filters:** `?active=` uses `z.stringbool()`, because `z.coerce.boolean()` would read `"false"` as true. Pagination coerces `page` and `pageSize` (defaults 1/25, max 200). `sort` is no longer on `paginationQuerySchema`: each `*ListQuerySchema` declares its own allow-list with `sortSchema(['code', 'name', …])`, a `z.templateLiteral` of `field:asc|desc`, so no list can be sorted on an arbitrary column.
18. **Gate:** contracts also got a 95% coverage threshold, matching core.

19. **Request schemas are strict.** Every create, update and list-query schema, and every auth/access request DTO (signup, login, select-tenant, switch-tenant, accept-invitation, user invite/update, role create/update/clone, item tax rate create, UoM rows, party addresses), is a `z.strictObject`, so an unknown or immutable key is a 422 (`unrecognized_keys`) instead of being silently dropped.
20. **Response schemas describe what is stored, not input rules.** They use plain `z.string()` (or an enum, uuid, date, timestamp, paise or `numeric` format), with no trims, transforms, checksums, E.164 or minimum-length rules, so a row stored before a rule existed still serialises. Each entity has a test with a realistic DB-shaped row. State codes in responses use `stateCodeSchema` (the full table, legacy included).
21. **State codes:** master addresses and state fields use `currentStateCodeSchema` (no legacy 25 or 28). `stateCodeSchema` keeps every code for stored and back-dated data. `placeOfSupplySchema` adds 96 (Other Countries) and 99 (Centre Jurisdiction) for documents (Sprint 2).
22. **Renames (T-102 review).** Money fields have no unit suffix, and access DTOs use the "user" naming (a user = a membership joined with its user):

    | Old                                                 | New                                                 |
    | --------------------------------------------------- | --------------------------------------------------- |
    | `creditLimitPaise` (party field)                    | `creditLimit` (column `credit_limit`)               |
    | `inviteUserSchema`, `InviteUser`, `InviteUserInput` | `userInviteSchema`, `UserInvite`, `UserInviteInput` |
    | `membershipUpdateSchema`, `MembershipUpdate`        | `userUpdateSchema`, `UserUpdate`                    |
    | `membershipResponseSchema`, `MembershipResponse`    | `userResponseSchema`, `UserResponse`                |
    | `paginationQuerySchema` field `sort` (any column)   | `sortSchema([...])` declared per list query         |
    | `Paginated<T>` (hand-written interface)             | removed; infer the type from `paginated(schema)`    |
    | core `splitTax(taxable, rate, cess, supplyType)`    | `splitTax(taxable, { rate, cess?, supplyType })`    |

    Unchanged: `userListQuerySchema`, `membershipStatusSchema`, `membershipSummarySchema` (the membership inside the token response) and every auth schema name. New: `userRecordSchema` and the `<entity>RecordSchema`s, `updateSchema`, `sortSchema`, `currentStateCodeSchema`, `placeOfSupplySchema`.

23. **Test helper:** `pathsOf` (and `unrecognizedKeysOf`) live in `src/testing/paths.ts`, excluded from the build and from coverage. Rejection tests assert the issue path.

## Verification

Run at the repo root on 2026-09-26:

- `pnpm --filter @ekaro/core --filter @ekaro/contracts run build`: both built.
- `pnpm lint --force`: 4/4 tasks successful. `pnpm typecheck --force`: 4/4 successful. `pnpm build --force`: 4/4 successful. `pnpm format:check`: clean.
- `pnpm test --force`: 4/4 tasks successful. `@ekaro/contracts`: **10 files, 215 tests passed**, with **100%** statements (275/275), branches (121/121), functions (39/39) and lines (256/256). `@ekaro/core`: 106 passed. `@ekaro/api`: 1 passed. `@ekaro/web`: 1 passed.
- Both apps: the apps do not import the contracts yet, and `apps/**` was out of scope. A probe file importing `@ekaro/core` and `@ekaro/contracts` (schemas, types, `ErrorCode`, `DEFAULT_ROLES`, `hasPermission`, `splitTax`, …) was type-checked with `tsc` using `apps/api/tsconfig.json` and `apps/web/tsconfig.json` as the base configs, with each app's own `node_modules`. Both passed.
- Refinement tests: GSTIN state vs company, branch and default billing state, and PAN vs GSTIN; `trackExpiry` needs `trackBatches` (create and update); the series 16-character width through padding and through the next number; GSTIN required or forbidden by registration type; default-address counts; Indian vs foreign addresses; HSN/SAC shape; UoM conversions; tax-rate flags; branch scope on invitations. `z.toJSONSchema` succeeds for every exported schema in both input and output mode.
- Review: the `code-reviewer` and `accounting-reviewer` agents could not be spawned from the implementing session, which has no sub-agent tool. The change was self-reviewed against their checklists. Running both agents before merge is a follow-up.

### Review fixes (2026-09-26)

After the `code-reviewer` and `accounting-reviewer` findings (Decisions 1–4, 6, 7, 13, 15–17 updated; 19–23 added):

- `pnpm format`, then `pnpm lint --force`, `pnpm typecheck --force`, `pnpm test --force` and `pnpm build --force` at the root: 4/4 tasks successful each (both apps compile); `pnpm format:check` clean.
- `@ekaro/contracts`: **11 files, 281 tests passed**. Coverage **100%** statements (287/287), branches (103/103), functions (43/43) and lines (274/274). `src/testing/**` is excluded from the build and from coverage.
- New tests: one merged-record test per entity with rules (company, branch, tax rate, item ×2, party ×2, document series, user); strict unknown/immutable keys on every create, update, list query and auth/access DTO; update without create defaults and rejection of a `{ version }`-only body per entity; a DB-shaped response row per entity; `sortSchema` allow-lists per list query; current state codes and place of supply; the tax-rate update accepting only `name`/`isActive`; the new permissions and Accountant grants.
