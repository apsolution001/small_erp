# 0009 — Single posting engine, append-only ledgers

**Status:** Accepted · 2026-09-26

## Decision
- `modules/posting` exposes `PostingService.post(request)`, where the request carries stock movements and GL lines from a source document, and `PostingService.reverse(sourceRef, date)`. It is the **only** writer of `stock_ledger_entries`, `gl_entries` and valuation layers (`stock_valuation_layers` for FIFO).
- Each business document builds a posting request from its own data through a pure *poster* function (for example `buildSalesInvoicePosting(invoice) → PostingRequest`). That function is unit tested with exact journals.
- The engine validates: the voucher balances, periods are open, stock is sufficient (under `FOR UPDATE` on the item-godown balance row) and accounts are active. It then writes all rows in the caller's transaction.
- Ledgers are append-only. Cancellation = reversal rows linked by `reverses_entry_id`.
- The nightly integrity job reconciles the ledgers against the balances.
