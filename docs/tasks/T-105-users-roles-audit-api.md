---
id: T-105
title: Users, invitations, roles, audit-log API
status: todo
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/01-platform-auth-access.md §3.3–3.4
---
## Scope
Invitations (with an outbox row for the email; the email adapter is SMTP to Mailpit), accepting an invitation, membership list and update (role, branches, status) with the safety rules, role CRUD and clone, and a paginated keyset audit-log query.
## Acceptance criteria
Every rule in spec 01 §3.3 has a test: no changing your own role, never disabling the last Owner, only an Owner assigns Owner, a role in use cannot be deleted, and system roles cannot be deleted.
