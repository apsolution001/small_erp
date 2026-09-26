---
id: T-152
title: 'Web: company, branches, godowns, series'
status: todo
sprint: 1
area: client
depends_on: [T-106, T-150]
spec: docs/standards/frontend.md, docs/specs/02-masters.md
---

## Scope

Company settings page (tabs: profile, GST, inventory settings), branches and godowns lists with dialog forms, document series table per branch and FY with a live number preview.

## Acceptance criteria

- Uses `features/<area>` structure, contracts schemas and the shared components from T-150.
- Loading, empty and error states. Permission-gated actions. Works at 1366×768.
- Unit tests for forms (validation + submit payload) and the list.
