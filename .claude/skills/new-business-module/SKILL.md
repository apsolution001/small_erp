---
name: new-business-module
description: Checklist and file templates for adding a new business entity or module to Ekaro (DB table with RLS + audit, contracts, Nest module, permissions, tests, web feature). Use whenever creating a new table/entity/endpoint set.
---

# Add a business entity

Follow the existing reference implementation, `apps/api/src/modules/masters/units` (API; conventions in ADR 0016) and, once T-153 lands, `apps/web/src/features/masters/units` (web). Copy its shape and do not invent a new one.

## API

1. **Schema** `src/modules/<area>/<entity>/<entity>.schema.ts`: use the `tenantTable()` helper from `src/infra/db/columns.ts`, which adds id (uuidv7), tenant_id, audit columns and version. Add check constraints mirroring the contracts, indexes `(tenant_id, ...)` for every FK and list filter, a `unique (tenant_id, id)` if other tables will reference it, and **composite** foreign keys `(tenant_id, x_id) → (tenant_id, id)` for references. Quantities and rates use `qtyColumn()` (`numeric(20,6)`), money `bigint` paise.
2. **Export** the table from `src/infra/db/schema.ts`.
3. **Migration:** run `pnpm --filter @ekaro/api db:generate --name <task>_<area>` (one generated migration per task; check that constraints a new FK targets come before the FK). Then `db:generate --custom --name <task>_<area>_security` with `select app_enable_tenant_table('<table>');` per table (RLS enable + force, `tenant_isolation`, DML grants to `ekaro_app`, audit trigger), plus any revokes or guard triggers.
4. **Contracts** `packages/contracts/src/<area>/<entity>.ts`: `<entity>ResponseSchema`, `<entity>CreateSchema` (strict, with defaults and rules), `<entity>UpdateSchema` (`updateSchema(fields)`: strict, no defaults, `version` required, at least one field), `<entity>RecordSchema` (`z.object(fields).superRefine(rules)`, used on the merged record) and `<entity>ListQuerySchema` (`paginationQuerySchema.extend({ sort: sortSchema([...]).optional(), ...filters })`). Export them from the package index.
5. **Permissions:** add `<area>.<entity>:{view,create,edit,delete,...}` to `packages/contracts/src/access/permissions.ts` and map them to the default roles.
6. **Repository** (`<entity>.repository.ts`): inject `TransactionHost<AppTransactionalAdapter>` and use `txHost.tx` only. `list` with `orderByOf`, `pageOffset`, `containsPattern`; `findById(id, { forUpdate })`; `insert`; `update(id, changes)` setting `version = version + 1`; `delete`.
7. **Mapper** (`<entity>.mapper.ts`): `to<Entity>Response(row)` with `recordMetaOf(row)`; never return internal columns.
8. **Service** (`<entity>.service.ts`), as in `UnitsService`:
   - writes go through `mapConstraintErrors(write, { <constraint>: () => new ConflictError('ALREADY_EXISTS', ...) })`;
   - update = `findById(id, { forUpdate: true })` → `assertVersion` → `changesOf(patch)` → `parseMergedRecord(xRecordSchema, toResponse(existing), changes)` → rules needing other data (`ValidationError.forField`) → `update`;
   - delete = `deleteUnlessReferenced` (hard delete, 409 `IN_USE`) for units/tax rates/categories, otherwise deactivate;
   - a rule that depends on a later module goes through a port (ADR 0016 §6).
9. **Controller**: `@RequirePermission` on every route, `ZodValidationPipe(<contract schema>)` on body and query, `@IdParam()` for `:id`, `@HttpCode(204)` on DELETE. Register controller, service and repository in `<area>.module.ts`.
10. **Tests:**
    - `<entity>.service.spec.ts` with the repository mocked (version conflict, merged-record 422, constraint mapping, business rules);
    - `test/<area>/<entity>.e2e-spec.ts` using `test/support/masters.ts` (`createTenant`, `rolesFor`, `expectProblem`, `errorPaths`, `auditTrail`): CRUD, 422 validation, 409 duplicate, 409 stale version, 403 for a role without the permission and 2xx for one with it, audit rows, API isolation (404 for another tenant's id);
    - add the table to `test/masters/isolation.e2e-spec.ts` (raw `ekaro_app` RLS) and update the table count in `test/db/migrations.e2e-spec.ts`.

## Web

1. `features/<area>/<entity>/api.ts`: query keys and list, get, create and update hooks.
2. `columns.tsx`, `<entity>-form.tsx` (react-hook-form + contracts schema) and the list page with DataTable, search and pagination.
3. Routes: `routes/_app/<area>/<entity>/index.tsx` (list) and `$id.tsx` / `new.tsx`, or a dialog form for small masters.
4. Add the sidebar nav entry, gated by `useCan('<area>.<entity>:view')`.
5. Tests: a form validation test and a list rendering test.
