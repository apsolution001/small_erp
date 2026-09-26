---
id: T-107
title: 'Masters API: units, tax rates, item categories, items'
status: done
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/02-masters.md
---

## Notes

`units` is the **reference implementation** that the other masters copy (see the new-business-module skill). Build it first and keep it exemplary.

## Acceptance criteria

Spec 02 for units, tax-rates, item-categories (tree, depth ≤ 3) and items (nested UoM conversions, effective-dated tax rates, HSN length vs company setting, and track_expiry ⇒ track_batches). Decimal strings round-trip exactly. Includes the standard e2e set.

## Decisions

The conventions shared by every master are in [ADR 0017](../adr/0017-masters-crud-conventions.md). Specific to this task:

1. **Units.** Hard delete while unreferenced; any foreign-key violation on the delete is 409 `IN_USE`. A duplicate code (codes are upper-cased) is 409 `ALREADY_EXISTS` naming the code. `?q=` searches code and name; the default sort is `code:asc`. Contracts gained `unitRecordSchema` (no cross-field rule yet), so the PATCH flow is the same as every other master's.
2. **Tax rates.** PATCH accepts `name`/`isActive` only (contracts). A `BEFORE UPDATE` trigger `tax_rates_rates_immutable` refuses any change to `gst_rate`, `cess_rate` or the three flags (check_violation), so no writer can change a slab's rates. A duplicate slab (same rates and flags, compared numerically: `18` = `18.00`) is 409. A slab an item has ever used is 409 `IN_USE`. Default sort `gstRate:asc`. Rates are returned as Postgres renders `numeric(7,4)`: `"18.0000"`.
3. **Item categories.**
   - Depth counts levels (a root is level 1); the deepest node of a moved subtree must stay at level ≤ 3. Depth and cycle checks use recursive CTEs (bounded at 16 steps) under a tenant advisory lock (`lockTenantScope('item_categories')`), because they span rows.
   - A parent must exist and be active (422 on `parentId`, as are cycles and depth).
   - Names are unique per parent case-insensitively, roots included (`unique (tenant_id, coalesce(parent_id, nil uuid), lower(name))`): 409 `ALREADY_EXISTS`.
   - `?tree=true` returns `ItemCategoryTreeNode[]` sorted by name at every level; only `active` applies to it, and an inactive node hides its whole subtree. Without `tree`, the list is a normal page.
   - DELETE is hard while the category has no children and no items; otherwise 409 `IN_USE`. Contracts gained `itemCategoryRecordSchema`.
4. **Items.**
   - The HSN length check (≥ `company_profile.hsn_min_digits`) runs on create and when a PATCH sends `hsnSac`, so raising the company minimum does not block edits of other fields on older items.
   - A reference the record **newly** makes (base, purchase, sales and conversion units; category) must be active; a reference an item already had stays valid after the unit or category is deactivated. Unknown and cross-tenant ids fail the same check (422 on the field); the composite foreign keys map to the same field errors as a backstop.
   - The initial `taxRateId` is stored with `effective_from` = the company's books-begin date. `POST /items/:id/tax-rates` refuses a date before the books (422 on `effectiveFrom`) and a second row on the same date (409). Inactive slabs may be used (they exist for back-dated rates).
   - `GET /items/:id/tax-rates` lists every row oldest first; `?on=YYYY-MM-DD` returns only the row in force (latest `effective_from <= on`), or `[]` before the first row. Contracts gained `itemTaxRateListQuerySchema`.
   - `item_tax_rates` is append-only: the migration revokes UPDATE and DELETE from `ekaro_app`.
   - Sending `units` on PATCH replaces the conversions as a diff (delete dropped, update changed factors, insert new), so the audit log shows real changes; a PATCH bumps the item's version even when only conversions change.
   - DELETE deactivates (204, idempotent). `?q=` matches code and name (contains) and HSN (prefix); filters `kind`, `type`, `categoryId`, `active`.
   - The company read path (`CompanyService.settings()`) was created here; T-106 adds the company endpoints.
5. **Migrations:** `0007_t107_masters_catalog.sql` (generated; the two `unique (tenant_id, id)` constraints on `units`/`tax_rates` were moved before the foreign keys that target them, since drizzle-kit emitted them last) and `0008_t107_masters_catalog_security.sql` (RLS/grants/audit via `app_enable_tenant_table`, the item tax rate revoke, the slab trigger).
6. **Tests:** permission tests take the allowed and denied roles from `DEFAULT_ROLES` (`rolesFor`). For a permission every default role holds (`masters.item:view`), the denied role is a custom role with no permissions, inserted directly (the role API is T-105).

## Plan

- [x] Shared helpers: list queries, optimistic lock + merged record, constraint mapping, record meta, tenant lock, `IdParam`, `ValidationError.forField`
- [x] Schemas + migrations 0007/0008 (renumbered after the base's 0005/0006 security migrations)
- [x] Units (reference), tax rates, item categories, items + item tax rates; `MastersModule` registered in `AppModule`
- [x] Unit specs per service; e2e per entity; raw RLS isolation for the new tables; migration table count
- [x] ADR 0017; new-business-module skill updated to the real paths and names

## Verification

Run on 2026-09-26 against local Postgres 16 + Redis 7, test DB `ekaro_masters_test` (env from `.env.example`, `REFRESH_COOKIE_SECURE` left at its default).

- `pnpm format`, `pnpm lint` (4/4), `pnpm typecheck` (4/4): clean.
- `pnpm test`: core **127**, contracts **296** (100% statements/branches/functions/lines), web **1**, api **168** passed.
- `pnpm --filter @ekaro/api test:e2e`: **16 files, 199 tests passed**, including:
  - `masters/units.e2e-spec.ts` (16): seeded page 2 of 18 by code; q on code and name; LIKE wildcards literal; 422 for sort/unknown params/pageSize; create 201 with a normalised code; PATCH bumps the version; `active` filter; stale version 409; delete 204 then 404; audit INSERT/UPDATE/DELETE by the owner with versions; 422 for bad UQC, decimals, unknown keys, malformed id, missing version, version-only body; duplicate code 409 on create and update; 403/2xx per permission; API isolation.
  - `masters/tax-rates.e2e-spec.ts` (7): the 10 seeded slabs with exact `numeric(7,4)` strings; cess slab create/rename/deactivate/delete with audit; 422 when PATCH sends rates; trigger refuses a raw rate update; slab rules 422; duplicate 409 (`18.00` vs `18`); permissions; isolation.
  - `masters/item-categories.e2e-spec.ts` (10): 3-level tree; 4th level, cycle and too-deep move refused on `parentId`; flat pages by parent; inactive subtree hidden; duplicate name 409 case-insensitively; IN_USE with children; audit; stale version; permissions; isolation including a foreign parent.
  - `masters/items.e2e-spec.ts` (17): create with conversions and the first rate from the books-begin date; `"50"` → `"50.000000"`, `"49.999999"` preserved, `"10.125"` → `"10.125000"`; search by HSN/name, filters and sort; PATCH replacing conversions with audit rows `INSERT 50.000000`, `UPDATE 25.000000`, `INSERT 1000.000000`; merged-record 422s; stale version; DELETE deactivates; units and slab in use → 409 `IN_USE`; HSN vs `hsn_min_digits = 6`; inactive unit/category and foreign unit/slab → 422 on the field; effective-dated rates (201, list, `?on=` before/at/after the change and before the books), duplicate date 409, date before the books 422; raw UPDATE/DELETE on `item_tax_rates` denied; permissions for items and item tax rates; isolation.
  - `masters/isolation.e2e-spec.ts` (12): forced RLS, `tenant_isolation` and the audit trigger on the 4 new tables; B sees none of A's rows; B updates/deletes 0 rows; a composite FK blocks pointing B's item at A's unit.
  - `tenancy/isolation.e2e-spec.ts` now also expects the tax-rate guard trigger; `db/migrations.e2e-spec.ts` expects 17 tables.
- Review: this sub-agent session has no agent tool, so `code-reviewer` and `accounting-reviewer` could not be run. Self-reviewed against the backend, database, accounting and testing standards; run both reviewers before merging.

## Follow-ups

- **Sprint 2 (posting):** lock `baseUnitId`, `trackBatches`/`trackExpiry` and conversion factors of an item once it has stock postings (a port like the company's, ADR 0017 §6); decide whether a unit's `decimalPlaces` may be lowered once quantities exist.
- **T-106 interplay:** if `booksBeginDate` moves earlier (allowed until the first posting), items created before keep their first rate at the old date, so `?on=` returns nothing for the gap. Decide whether the company PATCH should also move each item's first rate row, or whether the effective-rate lookup should fall back to the earliest row.
- **T-153 (web):** list responses are `paginated(xResponseSchema)`; `GET /item-categories?tree=true` returns `ItemCategoryTreeNode[]`; decimals come back at full scale (`"50.000000"`), so format them for display.
