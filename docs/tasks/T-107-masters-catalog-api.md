---
id: T-107
title: 'Masters API: units, tax rates, item categories, items'
status: todo
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/02-masters.md
---

## Notes

`units` is the **reference implementation** that the other masters copy (see the new-business-module skill). Build it first and keep it exemplary.

## Acceptance criteria

Spec 02 for units, tax-rates, item-categories (tree, depth ≤ 3) and items (nested UoM conversions, effective-dated tax rates, HSN length vs company setting, and track_expiry ⇒ track_batches). Decimal strings round-trip exactly. Includes the standard e2e set.
