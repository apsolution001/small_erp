---
id: T-106
title: 'Masters API: company, branches, godowns, document series'
status: todo
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/02-masters.md
---

## Acceptance criteria

Spec 02 endpoints for company, branches, godowns and document-series, with the rules: one head office, a branch GSTIN state that matches the branch state, no deactivating the head office or a branch that has active godowns, a series next_number that only increases, and the 16-character validation. Each has e2e CRUD, 403, 409-version and isolation tests.
