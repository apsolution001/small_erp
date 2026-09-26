---
id: T-102
title: '@ekaro/contracts: common, permissions, auth, access, masters schemas'
status: todo
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
