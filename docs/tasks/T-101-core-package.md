---
id: T-101
title: '@ekaro/core: money, decimal, GSTIN, states, FY, lifecycle'
status: todo
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
