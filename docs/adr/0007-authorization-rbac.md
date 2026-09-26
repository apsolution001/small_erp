# 0007 — Authorization: permission-based RBAC with branch scope

**Status:** Accepted · 2026-09-26

## Decision

- A **permission** is a string `<module>.<resource>:<action>`, where the action is one of `view | create | edit | delete | approve | post | cancel | export`. The permission catalogue is code (`@ekaro/contracts/access/permissions.ts`).
- A **role** is per tenant: a name plus a set of permissions. The nine BRD §8.1 roles are seeded at tenant creation as `is_system = true` templates. The owner can clone and edit them, but cannot edit or delete the `Owner` role.
- A **membership** is user + tenant + role + branch scope (`all_branches` or a list of branch ids) + `is_billable` (derived from the role: CA and Viewer are free).
- Enforcement: `PermissionGuard` checks the route's `@RequirePermission`. Services filter branch-scoped data by the membership's branches. The role and permissions are loaded per request, cached in Redis for 60 seconds and busted on role change.
- **Self-approval is forbidden**. The approval engine checks `approver != created_by`.
- Ekaro-side roles (platform admin, support, implementation partner) are separate, in the platform module, and never mixed with tenant roles.
