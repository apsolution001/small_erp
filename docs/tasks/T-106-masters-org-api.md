---
id: T-106
title: 'Masters API: company, branches, godowns, document series'
status: done
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/02-masters.md
---

## Acceptance criteria

Spec 02 endpoints for company, branches, godowns and document-series, with the rules: one head office, a branch GSTIN state that matches the branch state, no deactivating the head office or a branch that has active godowns, a series next_number that only increases, and the 16-character validation. Each has e2e CRUD, 403, 409-version and isolation tests.

## Decisions

Shared conventions: [ADR 0019](../adr/0019-masters-crud-conventions.md) (written with T-107).

1. **Company.**
   - `GET /company` and `PATCH /company` (merged record through `companyRecordSchema`: GSTIN state and PAN).
   - `valuationMethod` and `booksBeginDate` lock after the first stock posting: 409 `VALUATION_METHOD_LOCKED` / `BOOKS_BEGIN_DATE_LOCKED` (the second code is new in contracts). "Posted" is asked of a port, `STOCK_POSTINGS` (`StockPostingsPort.hasStockPostings()`), bound in `MastersModule` to `NoStockPostingsYet` (always false). Sprint 2's posting engine rebinds the token (ADR 0019 §6). The e2e suite swaps in a switchable fake through the new `createTestApp({ providers })` option to prove the lock.
   - Setting a locked field to its current value is not a change and passes.
   - **Moving the books earlier** (allowed until the first posting) would leave items with no GST rate between the new and the old books-begin date. The service therefore adds, for every item whose first rate starts after the new date, a row from the new date with that same first slab (`ItemsRepository.extendFirstRatesTo`, one INSERT…SELECT). Rows are added, never re-dated, so `item_tax_rates` stays append-only. Moving the books later needs nothing. (This closes the T-107 follow-up.)
   - `hsnMinDigits` changes apply to HSNs set or edited afterwards (T-107 decision 4).
2. **Branches.**
   - A branch GSTIN is registered in the branch state (contracts, merged record) **and** belongs to the company's PAN (characters 3–12), 422 on `gstin`, when the company has a PAN. Two branches in one state may share a GSTIN (one registration per state).
   - **Head office:** creating a head office, or setting `isHeadOffice: true` on another branch, moves the flag (the old head office is updated in the same transaction and audited). Unsetting the flag or deactivating (PATCH or DELETE) the head office is 422 `HEAD_OFFICE_REQUIRED`; an inactive branch cannot become the head office (422 on `isHeadOffice`).
   - Deactivating (PATCH `isActive: false` or DELETE) a branch with active godowns is 409 `BRANCH_HAS_ACTIVE_GODOWNS`.
   - DELETE deactivates (204, idempotent). Every branch and godown write takes a tenant advisory lock (`branches`), so "one head office" and "no inactive branch with active godowns" hold under concurrency.
3. **Godowns.** An active godown needs an active branch: creating one, moving it to another branch or re-activating it checks the branch (422 on `branchId`; an unknown or other tenant's branch reads the same). Renaming an inactive godown of an inactive branch is allowed. DELETE deactivates. Contracts gained `godownRecordSchema`.
4. **Document series.**
   - New column `last_issued_number bigint` (null = nothing issued), written only by number allocation (Sprint 2), exposed as `lastIssuedNumber` (string or null) in `documentSeriesResponseSchema`. A check keeps `next_number = last_issued_number + 1` once set, so numbers stay gapless.
   - `nextNumber` may only increase (422 `SERIES_NUMBER_DECREASE`). Once a number is issued, a PATCH that changes `prefix`, `suffix`, `padding` or `nextNumber` is 409 `SERIES_NUMBERING_LOCKED` (new code); `isDefault` stays editable. Sending a field with its current value is not a change.
   - **Rendered-number uniqueness per (GSTIN, document family, FY):**
     - The GSTIN of a series is its branch's own GSTIN, else the company's (a same-state branch without its own registration); an unregistered business's branches share one space.
     - Families (`docNumberFamily` in contracts): sales invoices form one; credit and debit notes form one (GSTR-1 table 9B); every other type is its own.
     - Two series collide if any n ≥ 1 renders the same string within 16 characters: `seriesNumbersCollide` in `@ekaro/core` decides this exactly per length (for example `SI/` padding 4 and `SI/0` padding 3 both give `SI/0001`; `SI/` padding 4 and `SI/` padding 5 both give `SI/10000`). It deliberately ignores where each series currently is (`nextNumber`), because issued history and future numbers both count.
     - A clash is 409 `SERIES_NUMBERS_OVERLAP` (new code), checked under a tenant advisory lock (`document_series`).
   - One default per (branch, type, FY): creating or patching a series with `isDefault: true` moves the flag. Unsetting the default is allowed (allocation in Sprint 2 must then be told the series).
   - A new series needs an active branch (422 on `branchId`). No DELETE (there is no delete permission): series are never removed.
   - **Database guard** `document_series_numbering_guard` (BEFORE UPDATE): branch, type and FY never change; `next_number` never decreases; once `last_issued_number` is set, prefix/suffix/padding are fixed and `last_issued_number` only moves forward.
5. **Migrations** (renumbered after the base's `0005/0006_sec_sessions_lockout*` and T-105's `0007/0008` when merging): `0011_t106_masters_org.sql` (generated: the column and the gapless check) and `0012_t106_masters_org_security.sql` (the guard trigger). The T-107 ones are `0009`/`0010`.
6. **Branch scope** (`membership.branchIds`) does not filter masters lists in Sprint 1: branches, godowns and series are company-wide setup, read by users of all branches (for example to pick a transfer destination). Documents will apply the scope (Sprint 2).

## Plan

- [x] Contracts: `lastIssuedNumber`, `godownRecordSchema`, `docNumberFamily`, error codes `BOOKS_BEGIN_DATE_LOCKED`, `SERIES_NUMBERING_LOCKED`, `SERIES_NUMBERS_OVERLAP`; core `seriesNumbersCollide`
- [x] Migrations 0011/0012
- [x] Company (port, controller, service, mapper), branches, godowns, document series; `MastersModule` wiring
- [x] Unit specs (company, branches, godowns, series service and rules); e2e per entity
- [x] Merge of the T-104 security fixes, migrations renumbered, ADR renumbered to 0019 (0016–0018 went to the base), T-105 merged

## Verification

Run on 2026-09-26 after merging `claude/brave-dirac-k9ikzp` (T-104 security fixes), local Postgres 16 + Redis 7, fresh databases `ekaro_masters` / `ekaro_masters_test` (env from `.env.example`, `REFRESH_COOKIE_SECURE` unset).

- `pnpm format`; `pnpm lint` 4/4; `pnpm typecheck` 4/4.
- `pnpm test`: core **130** (100% statements and branches, including `seriesNumbersCollide`), contracts **300** (100%), web **1**, api **223** passed.
- `db:migrate` on a fresh database: `migrations applied` (0000–0012).
- `pnpm --filter @ekaro/api test:e2e`: **21 files, 251 tests passed**. New in this task: Re-verified after merging T-105 and adding T-108: 25 files, 338 tests passed.
  - `masters/company.e2e-spec.ts` (8): the seeded profile of each tenant; PATCH with audit; stale version; 422 for fields, merged GSTIN vs state and the unknown `logoObjectKey`; valuation change before postings; 409 `VALUATION_METHOD_LOCKED` and `BOOKS_BEGIN_DATE_LOCKED` with the fake posting engine switched on while other settings stay editable; moving the books a year earlier gives an item's rate history `[earlier, original]` with the same slab; permissions; isolation.
  - `masters/branches.e2e-spec.ts` (11): seeded HO; a Karnataka branch with the company PAN; 422 for a GSTIN of another state or PAN; duplicate code 409; merged state change 422; the head-office flag moves and back (both audited); 422 `HEAD_OFFICE_REQUIRED` for unset/deactivate/DELETE; 409 `BRANCH_HAS_ACTIVE_GODOWNS`, then deactivation once the godown is inactive; inactive branch cannot be HO; stale version; search/sort; permissions; isolation.
  - `masters/godowns.e2e-spec.ts` (6): seeded Main and branch filter; create, move, deactivate with an exact audit trail; active-branch rule on create and re-activation; 422/409 cases; permissions; a foreign branch is 422.
  - `masters/document-series.e2e-spec.ts` (12): the 21 seeded defaults (`SI/<yy-yy>/0001`); an export series becoming the default (the old one loses the flag, version 2); 16-character 422s; `SERIES_NUMBERS_OVERLAP` for `SI/…/0` padding 3, CN vs DN, and a same-state branch without its own GSTIN; the same pattern accepted under a Karnataka GSTIN and in another FY; numbering changes before issue, `SERIES_NUMBER_DECREASE`, stale version; after a (simulated) issue, 409 `SERIES_NUMBERING_LOCKED` for prefix, suffix, padding and next number while `isDefault` still changes; the trigger refuses the same changes on a raw connection, and the gapless check refuses a lone `next_number` jump; audit; permissions (Admin creates, Accountant edits, Viewer views); isolation.
  - `tenancy/isolation.e2e-spec.ts` expects the series guard trigger.
- One pre-existing, timing-sensitive test from the merged base, `auth/sessions.e2e-spec.ts` › "expires a refresh token after 7 idle days…", failed once in a full run and passed alone and in the next full run (see follow-ups).
- Review: `code-reviewer` and `accounting-reviewer` could not be run from this sub-agent session (no agent tool). Self-reviewed against the standards; run both before merging.

## Follow-ups

- **Sprint 2 (posting):** bind `STOCK_POSTINGS` to the posting engine (it depends on masters, so rebind the token in `MastersModule` through a `forwardRef` or move the binding to the app module); allocation must set `last_issued_number` and `next_number` together under `FOR UPDATE`.
- **Company GSTIN changes** do not update the head-office branch's GSTIN; decide whether the company PATCH should refuse a GSTIN change once branches or series use it, or propagate it to the head office.
- **Base test flakiness (lead):** `auth/sessions.e2e-spec.ts` "expires a refresh token after 7 idle days…" compares millisecond and second-rounded instants built from `Date.now()` and database `now()`; under a loaded full run it failed once.
- **T-152 (web):**
  - `GET /company` → `CompanyResponse`; `PATCH /company` `CompanyUpdate` (needs `version`); 409 `VALUATION_METHOD_LOCKED` / `BOOKS_BEGIN_DATE_LOCKED` mean "disable the field".
  - Branches: 422 `HEAD_OFFICE_REQUIRED`; 409 `BRANCH_HAS_ACTIVE_GODOWNS`; making a branch the head office moves the flag, so refetch the list.
  - Series: show `lastIssuedNumber`; when it is non-null, disable prefix/suffix/padding/next number; 409 `SERIES_NUMBERS_OVERLAP` belongs next to the prefix.
