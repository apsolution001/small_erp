---
paths:
  - "packages/core/src/**"
  - "apps/api/src/modules/posting/**"
  - "apps/api/src/modules/accounts/**"
  - "apps/api/src/modules/inventory/**"
  - "apps/api/src/modules/gst/**"
  - "apps/api/src/modules/sales/**"
  - "apps/api/src/modules/purchase/**"
  - "apps/api/src/modules/production/**"
---
# Money / stock / GST rules (full text: docs/standards/accounting.md, which you must read)

- Money is bigint paise (`Money` from `@ekaro/core`). Rates and quantities are `Decimal`. Round ROUND_HALF_UP to the paise per line.
- Only `modules/posting` writes `stock_ledger_entries` or `gl_entries`. Vouchers must balance. Ledgers are append-only, and cancelling means a reversal.
- CGST+SGST when supplier state = place of supply. Otherwise IGST. Rates come from the `tax_rates` master, never from constants.
- Invoice series are gapless per series and FY, at most 16 characters, and allocated under `FOR UPDATE`.
- Run the `accounting-reviewer` agent before marking the task done.
