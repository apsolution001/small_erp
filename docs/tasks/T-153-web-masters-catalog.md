---
id: T-153
title: 'Web: units, tax rates, categories, items'
status: todo
sprint: 1
area: client
depends_on: [T-107, T-150]
spec: docs/standards/frontend.md, docs/specs/02-masters.md
---

## Scope

Units and tax-rates list+dialog; category tree; items list (filters: kind, category, active) and full item form with a UoM conversion grid and a tax-rate history tab. Keyboard-first entry.

## Acceptance criteria

- Uses `features/<area>` structure, contracts schemas and the shared components from T-150.
- Loading, empty and error states. Permission-gated actions. Works at 1366×768.
- Unit tests for forms (validation + submit payload) and the list.
