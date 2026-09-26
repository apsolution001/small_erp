---
id: T-104
title: Signup + tenant bootstrap, auth sessions, RBAC guards
status: todo
sprint: 1
area: server
depends_on: [T-102, T-103]
spec: docs/specs/01-platform-auth-access.md §1–3.2, docs/adr/0006-authentication.md, docs/adr/0007-authorization-rbac.md, docs/adr/0012-integration-ports.md
---

## Scope

- Tables: users, refresh_tokens (platform), roles, memberships, membership_branches, company_profile, branches, godowns, units, tax_rates, document_series (the minimal tables the bootstrap needs. Their CRUD APIs come in T-106/T-107).
- `GspProvider` port + `MockGspProvider` (deterministic lookup from the GSTIN: the state from its first 2 digits, a legal name derived from the PAN, and `Cancelled` status for GSTINs whose PAN starts with `ZZZZZ`, for tests).
- `TenantBootstrapService` (idempotent seeds per spec 02 §4).
- Auth: signup, login (+ tenant selection), refresh rotation with reuse detection, logout, switch-tenant, me, lockout, and throttling on auth routes (Redis store).
- `JwtAuthGuard` (global) and `PermissionGuard` (global, deny by default, Owner = all). Permissions are cached in Redis for 60 seconds and invalidated on role or membership change.

## Acceptance criteria

- The spec 01 §4 criteria for signup, login, refresh and switch, plus e2e tests for each role's allowed and denied access on a probe route.
- Passwords are bcrypt cost 12, and refresh tokens are stored hashed only.
