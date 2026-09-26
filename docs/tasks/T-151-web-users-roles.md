---
id: T-151
title: 'Web: users & roles'
status: todo
sprint: 1
area: client
depends_on: [T-105, T-150]
spec: docs/standards/frontend.md, docs/specs/02-masters.md
---

## Scope

Users list, invite dialog, edit membership (role, branches, status), roles list/edit with a permission matrix grouped by module, clone role. UI enforces the same safety rules and shows the API errors.

## Acceptance criteria

- Uses `features/<area>` structure, contracts schemas and the shared components from T-150.
- Loading, empty and error states. Permission-gated actions. Works at 1366×768.
- Unit tests for forms (validation + submit payload) and the list.
