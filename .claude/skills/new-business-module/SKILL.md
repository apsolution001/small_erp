---
name: new-business-module
description: Checklist and file templates for adding a new business entity or module to Ekaro (DB table with RLS + audit, contracts, Nest module, permissions, tests, web feature). Use whenever creating a new table/entity/endpoint set.
---

# Add a business entity

Follow the existing reference implementation, `apps/api/src/modules/masters/units` (API) and `apps/web/src/features/masters/units` (web). Copy its shape and do not invent a new one.

## API

1. **Schema** `src/modules/<area>/<entity>/<entity>.schema.ts`: use the `tenantTable()` helper from `src/infra/db/columns.ts`, which adds id (uuidv7), tenant_id, audit columns and version. Add check constraints and indexes `(tenant_id, ...)`.
2. **Export** the table from `src/infra/db/schema.ts`.
3. **Migration:** run `pnpm --filter @ekaro/api db:generate --name <area>_<entity>`. Then add a custom migration that calls `select app_enable_tenant_table('<table>');`. That function enables and forces RLS, creates the policy, grants DML to `ekaro_app` and attaches the audit trigger.
4. **Contracts** `packages/contracts/src/<area>/<entity>.ts`: define `<Entity>Schema` (response), `Create<Entity>Schema`, `Update<Entity>Schema` (with `version`) and `List<Entity>QuerySchema`. Export them from the package index.
5. **Permissions:** add `<area>.<entity>:{view,create,edit,delete,approve?}` to `packages/contracts/src/access/permissions.ts` and map them to the default roles in `default-roles.ts`.
6. **Repository / service / controller** following the reference module. The service holds business rules and uniqueness → `ConflictError`.
7. **Register** the Nest module in `<area>.module.ts`.
8. **Tests:** service unit spec, plus an e2e spec covering CRUD, validation 400, duplicate 409, stale version 409, permission denied 403 and tenant isolation.

## Web

1. `features/<area>/<entity>/api.ts`: query keys and list, get, create and update hooks.
2. `columns.tsx`, `<entity>-form.tsx` (react-hook-form + contracts schema) and the list page with DataTable, search and pagination.
3. Routes: `routes/_app/<area>/<entity>/index.tsx` (list) and `$id.tsx` / `new.tsx`, or a dialog form for small masters.
4. Add the sidebar nav entry, gated by `useCan('<area>.<entity>:view')`.
5. Tests: a form validation test and a list rendering test.
