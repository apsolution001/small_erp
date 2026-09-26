---
id: T-108
title: 'Masters API: parties + addresses'
status: done
sprint: 1
area: server
depends_on: [T-104]
spec: docs/specs/02-masters.md
---

## Acceptance criteria

Party CRUD with nested addresses. GSTIN is required for regular, composition and SEZ, and its state code must equal the default billing state. There is exactly one default billing address. Credit limit is paise and nullable. Includes search by name, code and GSTIN and the standard e2e set.

## Decisions

Shared conventions: [ADR 0019](../adr/0019-masters-crud-conventions.md).

1. **Tables** `parties` and `party_addresses` (composite FK to the party). Database checks mirror the contract rules that need no other table: a GSTIN exactly for regular/composition/SEZ (`parties_gstin_by_registration`), GSTIN and PAN formats, PAN = GSTIN characters 3–12, credit limit ≥ 0, credit days 0–999, lengths. Addresses: at most one default per (party, kind) (partial unique index); an Indian address has a state and a 6-digit PIN, and a foreign one has no state and a postcode of ≤ 10 characters.
2. **Rules on the whole record** come from `partyRecordSchema`: GSTIN required or forbidden by registration type, GSTIN state = the default billing address state, PAN, exactly one default billing address and at most one default shipping address. A PATCH validates `{ ...stored party with its addresses (ids kept), ...patch }`, so changing the registration type or the billing state alone is checked against the rest.
3. **Addresses on PATCH** replace the list. An address with an `id` updates that stored address, one without is new, and stored addresses left out are deleted. An `id` of another party or a repeated `id` is 422 on `addresses.<i>.id`; an `id` on create is 422 too. The writes are planned as a diff (`planAddressChanges`): delete, then clear any default that moves, then update the addresses that really changed, then insert. So the partial index never trips, and the audit log shows only real changes. Addresses are part of the party aggregate and are hard deleted (documents will copy the address they use, Sprint 2).
4. **Credit limit** is `credit_limit bigint` paise, carried as a string end to end (`BigInt` in the API), so values beyond 2^53 are exact. Null = no limit, `"0"` = cash only.
5. **Search:** `?q=` matches name and code (contains) and GSTIN (prefix). `?type=customer` and `?type=vendor` include parties of type `both`, and `?type=both` only those. The default sort is `name:asc`.
6. **Contracts:** `partyCreateSchema` now defaults an absent `gstin` to null, as `branchCreateSchema` does, so an unregistered, consumer or overseas party need not send it (a regular party without one is still a 422 on `gstin`).
7. Two parties may share a GSTIN (for example separate ledgers for one customer's sites, as Tally allows). The GSTIN is not verified against the GSP on save; the web can use `GET /platform/gstin/:gstin` to fill the form.
8. DELETE deactivates (204, idempotent).
9. **Migrations:** `0013_t108_masters_parties.sql` (generated) and `0014_t108_masters_parties_security.sql` (`app_enable_tenant_table` for both tables).

## Plan

- [x] Schema + migrations 0013/0014
- [x] Repository, address planner, service, controller, mapper; module wiring
- [x] Contract default for `gstin`
- [x] Unit specs (service, planner); e2e (`masters/parties.e2e-spec.ts`); raw RLS isolation of both tables; migration count

## Verification

Run on 2026-09-26 on the tree that contains the T-104 security fixes and T-105 (`claude/brave-dirac-k9ikzp`, no newer commits), fresh `ekaro_masters_test`:

- `pnpm format`; `pnpm lint` 4/4; `pnpm typecheck` 4/4.
- `pnpm test`: core **130**, contracts **328** (100% statements and branches), web **78**, api **285** passed.
- `pnpm --filter @ekaro/api test:e2e`: **25 files, 338 tests passed**, including:
  - `masters/parties.e2e-spec.ts` (14):
    - A regular customer with billing and shipping addresses, credit limit `"5000000000"` paise returned exactly.
    - `"9007199254740993"` exact through the API and in the column; `"0"` and null.
    - A consumer and an overseas vendor (US address, no state) without a GSTIN.
    - Search by name, code and GSTIN prefix (lower case), `type=vendor` including `both`, and sort with the total.
    - PATCH moving the default billing address to a new one, keeping ids, with the party audited INSERT/UPDATE and the old address audited INSERT, then exactly one UPDATE.
    - Dropped addresses are deleted. DELETE deactivates (version 4).
    - 422s: a GSTIN missing or forbidden, a GSTIN of another state, a wrong PAN, no default billing address, a bad PIN, a negative or decimal credit limit, a merged billing state change, a foreign address id.
    - Duplicate code 409, stale version 409, permissions for view/create/edit/delete, isolation.
  - `masters/isolation.e2e-spec.ts` now covers `parties` and `party_addresses` (forced RLS, policy, audit trigger; no cross-tenant reads, updates or deletes).
  - `db/migrations.e2e-spec.ts` expects 22 tables.
- Review: `code-reviewer` and `accounting-reviewer` could not be run from this sub-agent session. Self-reviewed; run both before merging.

## Follow-ups

- **T-154 (web):**
  - `POST /parties` takes `PartyCreate` (addresses without ids). `PATCH /parties/:id` takes `PartyUpdate`, and when `addresses` is sent it is the whole list: send ids back to keep addresses.
  - `creditLimit` is a paise string (format with `Money` from core).
  - 422 paths: `gstin`, `pan`, `addresses`, `addresses.<i>.<field>`.
- **Sprint 2:** a party-type scope for the Purchase/Sales roles (T-102 decision 7), and whether duplicate GSTINs should warn.
