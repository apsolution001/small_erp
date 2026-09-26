# 0005 — Money as integer paise, quantities as decimals

**Status:** Accepted · 2026-09-26

## Context

BRD §11: "money stored as integer paise". Floats are unacceptable for books of account.

## Decision

- **Amounts** are `bigint` paise in the DB, `Money` (wrapping `bigint`) in TypeScript, and a decimal _string of paise_ in JSON (`"1234550"` = ₹12,345.50), because JSON numbers cannot hold every bigint.
- **Unit rates** are `numeric(20,6)` rupees. Traders quote rates like ₹0.4575/pc, which do not fit in paise. The line amount is `round_half_up(qty × rate × 100)` paise, computed with `Decimal` (decimal.js) in `@ekaro/core`.
- **Quantities** are `numeric(20,6)`, a `Decimal` in TS, and a decimal string in JSON.
- **Percentages** are `numeric(7,4)`.
- All arithmetic lives in `@ekaro/core`, which is 100% unit tested. The web uses the same package for live totals, so the screen always equals the posted amount.

## Consequences

- There are no rounding drifts between UI, API and reports.
- Every API consumer must treat money and quantity fields as strings. The contracts enforce this.
