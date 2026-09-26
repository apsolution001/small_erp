---
id: T-155
title: 'Playwright: signup → masters journey'
status: todo
sprint: 1
area: client
depends_on: [T-151, T-152, T-153, T-154]
spec: docs/standards/frontend.md, docs/specs/02-masters.md
---

## Scope

E2E: sign up with a mock GSTIN, create a unit, an item with conversion and a party, invite a user, log out and log in. Runs in CI against the built web + API.

## Acceptance criteria

- Uses `features/<area>` structure, contracts schemas and the shared components from T-150.
- Loading, empty and error states. Permission-gated actions. Works at 1366×768.
- Unit tests for forms (validation + submit payload) and the list.
