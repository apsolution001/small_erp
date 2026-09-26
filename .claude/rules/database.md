---
paths:
  - "apps/api/db/**"
  - "apps/api/src/**/*.schema.ts"
  - "apps/api/src/infra/db/**"
---
# Database rules (full text: docs/standards/database.md)

- UUIDv7 primary keys. `bigint` paise for money. `numeric(20,6)` for quantities and rates. `text` + check constraints for enums.
- Unique business keys include `tenant_id`. Index every FK and every list filter.
- Migrations are forward-only and never edited after merge. RLS, grants and triggers go in custom SQL migrations.
- `ekaro_app` never gets UPDATE or DELETE on ledgers or `audit_log`.
