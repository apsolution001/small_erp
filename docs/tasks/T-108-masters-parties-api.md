---
id: T-108
title: 'Masters API: parties + addresses'
status: todo
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/02-masters.md
---

## Acceptance criteria

Party CRUD with nested addresses. GSTIN is required for regular, composition and SEZ, and its state code must equal the default billing state. There is exactly one default billing address. Credit limit is paise and nullable. Includes search by name, code and GSTIN and the standard e2e set.
