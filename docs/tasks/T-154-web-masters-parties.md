---
id: T-154
title: "Web: parties"
status: todo
sprint: 1
area: client
depends_on: [T-108, T-150]
spec: docs/standards/frontend.md, docs/specs/02-masters.md
---
## Scope
Parties list (filters: type, active; search name/code/GSTIN) and party form with GSTIN auto-fill of state and PAN, address grid (billing/shipping, default), and credit terms.
## Acceptance criteria
- Uses `features/<area>` structure, contracts schemas and the shared components from T-150.
- Loading, empty and error states. Permission-gated actions. Works at 1366×768.
- Unit tests for forms (validation + submit payload) and the list.
