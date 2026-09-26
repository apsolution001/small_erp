# 0010 — Document lifecycle, approvals and numbering series

**Status:** Accepted · 2026-09-26

## Decision
- All transactional documents share a lifecycle state machine (BRD §9.4): `draft → submitted → approved → posted → cancelled`, plus `submitted → rejected → draft`. Transitions are defined once in `@ekaro/core/lifecycle` and enforced in the service and by a DB check constraint on `status`.
- When no approval rule matches (PL-03: by document type, branch and amount threshold), `submit` auto-approves. The approver must hold `<doc>:approve` and must not be the creator.
- **Numbering series** (MS-05): the `document_series` table holds (tenant, branch, doc_type, fy, prefix, suffix, padding, next_number). The number is allocated **at post time** (not at draft time), inside the posting transaction, with `SELECT ... FOR UPDATE`. That guarantees gapless GST invoice numbers. Drafts show a provisional reference `DRAFT-<short id>`.
- The rendered number must be at most 16 characters and use `[A-Za-z0-9/-]` (GST rule 46). This is validated when the series is created.
