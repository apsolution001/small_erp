---
id: T-101
title: '@ekaro/core: money, decimal, GSTIN, states, FY, lifecycle'
status: done
sprint: 1
area: shared
depends_on: [T-003]
spec: docs/adr/0005-money-and-quantities.md, docs/standards/accounting.md, docs/specs/02-masters.md#1
---

## Goal

Build pure, framework-free domain primitives used by both the API and the web. Target 100% unit test coverage, with a ≥ 95% gate.

## Scope

- `id`: `uuidv7()`.
- `money`: `Money` immutable class over `bigint` paise. `of(paise)`, `fromRupees(string)`, `toRupeesString()`, `add`, `subtract`, `multiply(Decimal) → rounded HALF_UP`, `negate`, `isZero/isNegative`, `compare`, `allocate(ratios)` (largest remainder, no lost paise), `sum(list)`, `toJSON()` → paise string, `parse(paiseString)`. Plus `formatINR(money)` with Indian grouping (`₹12,34,567.50`).
- `decimal`: re-export a configured `Decimal` (decimal.js, precision 40, ROUND_HALF_UP), `parseQty(string)`, `formatQty(d, dp)`, and `lineAmount(qty, rate) → Money` (= round_half_up(qty × rate × 100)).
- `gst`: `splitTax(taxable: Money, ratePct: Decimal, cessPct, supplyType: 'intra'|'inter') → { cgst, sgst, igst, cess }` with line-level rounding. When the rate is odd in paise, CGST and SGST are each rounded half-up on half the rate, so the totals can legitimately differ by 1 paise from rate×taxable. Document that. `supplyTypeFor(supplierState, placeOfSupplyState)`.
- `gstin`: `isValidGstin` (regex + mod-36 checksum), `gstinStateCode`, `gstinPan`, `computeGstinChecksum`.
- `states`: GST state code table (01–38, 97) with names. `isValidStateCode`.
- `uqc`: the GST UQC list.
- `fy`: `fyOf(date)`, `fyRange(label)`, `fyShort(label) → '26-27'`, `currentFy(now)`.
- `lifecycle`: the document status enum and `canTransition(from, to)` and `assertTransition` (per ADR 0010).
- `series`: `formatDocNumber({prefix, suffix, padding}, n)` and `validateSeries(...)` (≤ 16 chars, allowed charset, per GST rule 46).

## Acceptance criteria

- Exact-value tests for rounding edge cases (0.5 paise, negative amounts, huge amounts beyond 2^53), allocate sums back to the total, and GSTIN checksum against known valid and invalid GSTINs.
- No runtime dependency other than `decimal.js` and `uuid`.

## Plan

- [x] `decimal.ts`: configured `Decimal` clone, `toDecimal`, `parseQty`, `parseRate`, `formatQty`.
- [x] `money.ts`: `Money`, `lineAmount`, `formatINR` (+ fast-check property tests).
- [x] `states.ts`, `uqc.ts`, `gstin.ts`, `gst.ts`.
- [x] `fy.ts`, `lifecycle.ts`, `series.ts`.
- [x] `index.ts` exports every module; `vitest.config.ts` coverage thresholds at 95%.

## Decisions

1. **`lineAmount` lives in `money.ts`**, not `decimal.ts`. It returns `Money`, and putting it in `decimal` would create a `decimal ↔ money` import cycle. It is exported from the package root as specified.
2. **`Decimal` is a `decimal.js` clone** (precision 40, `ROUND_HALF_UP`, no exponential notation between 1e-40 and 1e40), so configuring it never changes the global `decimal.js` other libraries use. 40 digits holds `numeric(20,6) × numeric(20,6)` exactly. It is imported by name (`import { Decimal } from 'decimal.js'`) because the default import does not type under `NodeNext`.
3. **HALF_UP is symmetric:** ties round away from zero, so −0.5 paise → −1 paise. A credit note therefore mirrors its invoice exactly.
4. **`Money.of` takes `bigint` only.** Accepting `number` would invite float money. `Money.fromRupees` rejects more than 2 decimal places instead of rounding silently. `Money.parse` accepts `^-?\d+$`.
5. **`Money.allocate`** scales ratios to integers and uses bigint arithmetic, so it is exact at any size. Leftover paise go to the largest remainders, with ties going to the earlier part. Zero ratios never receive a paisa. A negative total is allocated as its absolute value and then negated. Empty, negative, non-finite and all-zero ratios throw.
6. **`formatINR`** puts the sign before the symbol (`-₹12,34,567.50`, matching `Intl` `en-IN`) and takes `{ symbol: false }` for dense tables (frontend standard: `12,34,567.00`).
7. **`parseQty` / `parseRate`** accept exactly what `numeric(20,6)` stores: ≤ 14 integer digits and ≤ 6 decimals. A rate is never negative. A quantity may be negative (adjustments and returns).
8. **`splitTax`** returns `total` as well as the components. It rejects a GST rate outside 0–100 and a negative cess. Cess has no upper bound, because compensation cess slabs above 100% exist. `sgst` also carries **UTGST**: `STATES[].levy` says which one applies for posting and printing.
9. **`supplyTypeFor(..., { zeroRated: true })` returns `inter`**, because supplies to an SEZ and exports are inter-state whatever the states are (IGST Act s. 7(5), s. 16). Unknown state codes throw.
10. **States:** codes 01–38 and 97 are all valid (spec 02). `25` (Daman and Diu) and `28` (old Andhra Pradesh) are flagged `legacy` so that pickers can hide them while old GSTINs still validate. Each entry has `kind` (state, union territory or other territory) and `levy` (SGST or UTGST). Union territories without a legislature, and code 97, levy UTGST.
11. **UQC:** the 45 GSTN UQC codes, including `GGK` (great gross) as spelt in the GSTN/e-invoice master. All 18 seed units in spec 02 §4 are in the list.
12. **`isValidGstin`** also requires a known state code, on top of the regex and the checksum. It is strict about case and whitespace, and the contracts schema normalises input first. Special-format registrations (UIN for UN bodies, NRTP, OIDAR) do not match the spec 02 regex and are out of scope until a spec needs them. `gstinStateCode` and `gstinPan` throw on an invalid GSTIN rather than slicing garbage.
13. **`fyOf(Date)` reads the instant on the Indian calendar (IST, UTC+05:30, no DST)**, so the result does not depend on the server's time zone. `fyOf('YYYY-MM-DD')` treats the string as a plain calendar date and rejects impossible days. Labels must be consecutive years (`2099-00` is valid).
14. **Lifecycle:** the transitions are `draft→submitted`, `submitted→approved|rejected`, `rejected→draft`, `approved→posted|cancelled` (BRD §9.4 allows cancelling an approved document) and `posted→cancelled`. `canDelete` is true only for `draft`. Illegal moves throw `InvalidTransitionError` with `code: 'INVALID_TRANSITION'` for the API's 409 mapping.
15. **Series:** the rendered width is `prefix + max(padding, digits(nextNumber)) + suffix ≤ 16`, so every number the padding can hold (up to `10^padding − 1`) fits, and so does the next number. `validateSeries` returns field-level issues (`{ code, field }`) so that contracts and the API can map them to form fields. `formatDocNumber` re-validates and throws rather than issue a number that breaks rule 46. `maxDocNumber` gives the capacity. Prefix ≤ 10, suffix ≤ 6, padding 1–8 (spec 02).
16. **`fast-check`** was added as a **dev** dependency of core only, for the money property tests that `docs/standards/testing.md` asks for. The runtime dependencies are still only `decimal.js` and `uuid`.

## Verification

Run at the repo root on 2026-09-26:

- `pnpm --filter @ekaro/core --filter @ekaro/contracts run build`: both packages built.
- `pnpm lint`: 4/4 tasks successful. `pnpm typecheck`: 4/4 successful.
- `pnpm test`: 4/4 tasks successful. `@ekaro/core`: **10 files, 106 tests passed**. Coverage: **100% statements (230/230), branches (138/138), functions (76/76), lines (204/204)**, with the gate at 95% lines, statements, functions and branches.
- Acceptance: the exact-value tests cover 0.5-paise ties (`lineAmount('1','0.005') = 1`), negative amounts (`-0.5 → -1`, credit-note tax split), amounts beyond 2^53 (`2^60`, `i64::MAX × 0.18`, 30-digit line amounts) and allocate sum-back (a property test over 100 random cases plus exact cases). GSTIN tests cover `27AAPFU0939F1ZV` and `29AAGCB7383J1Z4` as valid, wrong check characters as invalid, and all 490 single-character substitutions of each as detected.
- Runtime dependencies: `decimal.js` and `uuid` only.
- Review: the `accounting-reviewer` and `code-reviewer` agents could not be spawned from the implementing session, which has no sub-agent tool. The change was self-reviewed against both checklists: GST split by place of supply, line-level HALF_UP, rates as data and rule-46 numbering. Running both agents on this branch before merge is a follow-up.
