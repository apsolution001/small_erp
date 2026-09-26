# 0017 — Masters CRUD conventions: locking, merged records, references and deletes

**Status:** Accepted · 2026-09-26 · refines ADR 0003, 0008 and 0013 (T-106, T-107, T-108)

## Context

Sprint 1 builds CRUD APIs for ten masters (spec 02). The backend standard names the layers and the status codes, but not how a master handles concurrent edits, cross-field rules on a partial update, references between masters, deletes of rows that later modules will reference, or rules that depend on data that only exists from Sprint 2 on (stock postings, issued document numbers). Choosing these per entity would give ten slightly different behaviours. `units` is the reference implementation that the new-business-module skill points to.

## Decision

1. **Optimistic locking, checked under a row lock.** An update reads the row `SELECT … FOR UPDATE` in the request transaction, compares its `version` with the one the client sent (409 `VERSION_CONFLICT` on a mismatch), then writes only the fields sent and sets `version = version + 1`. The row lock makes the comparison and the write atomic without a `WHERE version = …` retry loop.
2. **Merged-record validation** (T-102 decision 3). Every PATCH parses `xRecordSchema.parse({ ...existing, ...changes })` before writing, so cross-field rules always see the whole record. Every master has a record schema, even one with no cross-field rule yet (`unitRecordSchema`), so the flow is identical everywhere.
3. **The database is the arbiter of uniqueness and references.** Services do not check-then-insert. A named constraint violation is mapped to a domain error (`mapConstraintErrors`): a unique key to 409 `ALREADY_EXISTS` with a readable message, a foreign key to a 422 on the field that names the missing row. Rules that span rows and that no constraint can express (a category tree's depth, overlapping numbering series) run under a transaction-scoped advisory lock on the tenant and a scope name (`lockTenantScope`), so two concurrent requests cannot both pass the check.
4. **References are composite foreign keys** `(tenant_id, x_id) → (tenant_id, id)`, so a row can never point at another tenant's row, not even by a guessed id.
5. **Deletes.** A master that other rows may reference is never hard deleted:
   - `units`, `tax_rates` and `item_categories` (spec 02 §3) are hard deleted while unreferenced. Any foreign-key violation on the delete means the row is in use: 409 `IN_USE` ("deactivate it instead"). Because every reference is a foreign key, references added by later modules are covered without changing the master.
   - `items`, `parties`, `branches` and `godowns`: DELETE deactivates (`is_active = false`, 204, idempotent).
   - A newly made reference must point at an **active** row (422 on the field). An existing reference to a row deactivated later stays valid.
6. **Rules that depend on later sprints go through ports.** When a master's rule depends on facts another module will own (for example "valuation method locked after the first stock posting"), the masters module declares a small port interface and injection token, and binds a default that reports the fact as absent until the owning module exists. The owning module rebinds the token (Sprint 2), and the rule, its error code and its tests are already in place. Where the fact is a column the owning module will write (a series' `last_issued_number`), the column and a database guard are added now instead.
7. **Rules that need other data and belong to one field** are reported as a 422 `VALIDATION_FAILED` with that field's path (`ValidationError.forField`), so forms can show them in place: HSN length vs the company setting, an inactive unit, a category depth. A conflict with other records' current state (in use, locked, has active godowns) is a 409 with its own code. A request that breaks a rule on its own (head office required) is a 422 with its own code.
8. **Responses are mapped explicitly** (`<entity>.mapper.ts`): `recordMetaOf` gives `id`, `version` and ISO timestamps, and internal columns (`tenant_id`, `created_by`, `updated_by`) never leave the API. Decimal and percent columns are returned exactly as Postgres renders them (`"50.000000"`, `"18.0000"`); money is a paise string.

## Consequences

- Each master is a controller, a service, a repository, a mapper and a schema with the same shape; the shared pieces live in `common/record-updates.ts`, `infra/db/list-query.ts`, `infra/db/constraint-errors.ts`, `infra/db/tenant-lock.ts` and `infra/db/record-meta.ts`.
- A service never catches a unique or foreign-key violation it did not name, so an unexpected one still surfaces (a generic 409 for a unique violation, otherwise a 500 with the log).
- A failed constraint aborts the request's transaction. That is correct here: every mapped violation ends the request.
- Sprint 2 must bind the real port implementations (see the T-106 follow-ups).
