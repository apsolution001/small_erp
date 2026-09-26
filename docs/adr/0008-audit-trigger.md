# 0008 — Audit log via database trigger

**Status:** Accepted · 2026-09-26

## Decision

- A generic PL/pgSQL trigger `audit_row_change()` runs AFTER INSERT/UPDATE/DELETE on every tenant table and inserts into `audit_log` the old and new row (`to_jsonb`), the action, `app.user_id`, `app.request_id` and `now()`.
- `audit_log` is RLS-protected, and `ekaro_app` holds INSERT and SELECT only (append-only). It is partitioned by month (declarative partitioning) for the 8-year retention.
- UPDATEs that change nothing (`old = new`) are skipped.

## Why not application-level

You cannot forget a trigger. It catches every write path (jobs, imports, fixes) and guarantees PL-04 "every create, edit and delete with old and new values".
