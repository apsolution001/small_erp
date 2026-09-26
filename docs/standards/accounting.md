# Accounting, stock & GST standards

These rules protect the numbers the customer files with the government. Treat any violation as a P0 bug.
Every change in this area needs review by the `accounting-reviewer` agent, and the CA consultant reviews it each sprint (BRD §15).

## Money

- Store and compute money as **integer paise** with `bigint` in the DB and `Money` (bigint-backed) from `@ekaro/core/money` in TS. JSON carries money as a **string of paise** (`"123450"`) so no precision is lost.
- **Rounding** is `ROUND_HALF_UP` to the paise at **line level**. Taxes are computed per line on the line's taxable value, then summed. Invoice rounding to the nearest rupee (a "round-off" ledger) is a company setting and defaults to on.
- `line_amount_paise = round_half_up(quantity × rate × 100)`, then minus discount, which gives the taxable value. Rates are `numeric(20,6)` rupees, and the computation happens in `Decimal`, never in float.
- Never divide money without saying where the remainder goes. Use `Money.allocate(ratios)` for splits, which is largest-remainder and loses no paise.

## Quantities & units

- Quantities are `Decimal` (`numeric(20,6)`). Each item has a **base UoM**, and every other UoM has a conversion factor to base. Stock ledger rows are always in the base UoM, and the document line keeps the entered UoM and its factor.

## Double entry

- Every GL voucher balances: `sum(debit) = sum(credit)`. The posting engine enforces it and a deferred constraint trigger enforces it again. An unbalanced voucher cannot commit.
- `gl_entries` and `stock_ledger_entries` are append-only. Cancellation writes a reversal voucher dated on the cancellation date (or the original date if the period is open and the company setting allows it). The original is never edited.
- Each posting row links to its source document (`source_type`, `source_id`, `source_line_id`), so every number traces back to a document.
- A closed financial year or locked period rejects postings dated inside it (`PERIOD_LOCKED`).

## Chart of accounts

- Tally-style **groups** (Capital Account, Current Assets, Sundry Debtors, Sundry Creditors, Duties & Taxes, Sales Accounts, Purchase Accounts, Direct/Indirect Expenses/Incomes, Bank Accounts, Cash-in-hand, Stock-in-hand, ...) with nature Asset / Liability / Income / Expense. Seeded per tenant from the industry template.
- Every party (customer or vendor) has its own ledger under Sundry Debtors or Sundry Creditors. GST ledgers are system ledgers: Input/Output CGST, SGST, IGST and Cess.

## GST

- **Place of supply** decides the tax type. If supplier state = place-of-supply state, charge **CGST + SGST** (each half of the rate). Otherwise charge **IGST**. For goods, the place of supply is the delivery location's state. Unregistered buyers use the delivery address state.
- GST rates are **data** (the `tax_rates` master with effective dates), never constants in code. Rates changed in the GST 2.0 reform, and they will change again.
- A tax-rate slab is **immutable in its rates** once created: only its name and active flag change. A rate change is a new slab plus an effective-dated `item_tax_rates` row, so documents dated before the change keep the old rate (spec 02).
- **Compensation cess is ad valorem only in V1.** `splitTax` computes cess as a percentage of the taxable value. Specific (per-unit, e.g. ₹ per 1,000 sticks) and compound (ad valorem + specific) cess are out of V1 scope, and no item should be set up with them until a spec adds them.
- An HSN code is mandatory on items: at least 4 digits where turnover ≤ ₹5 cr and 6 digits above that (a company setting). SAC is used for services.
- Invoice numbers are **gapless and unique per series per financial year**, at most 16 characters, allowed characters `A-Z a-z 0-9 / -` (GST rule 46). They are allocated inside the posting transaction with `SELECT ... FOR UPDATE` on the series row.
- E-invoice and e-way bill go through the `GspProvider` interface only (the provider is still an open decision, and sandbox and mock implementations exist). An IRN can be cancelled only within 24 hours. After that, use a credit note.
- Credit and debit notes reference the original invoice number and date.

## Stock

- Stock moves only through the posting engine. There is one row per item × godown × batch movement, and the quantity is in the base UoM.
- The valuation method (**FIFO** or **weighted average**) is set per company at setup. It is locked after the first stock posting.
- Negative stock is **blocked by default**, with a per-company setting to allow it for specific godowns. Block checks run inside the posting transaction under row locks.
- Nightly integrity job: stock ledger totals = stock valuation report, trial balance debits = credits, and the stock-in-hand ledger = stock value (when perpetual inventory is on). Any mismatch raises an alert.

## Financial year

- The Indian FY runs 1 April – 31 March, labelled like `2026-27`. Utilities are in `@ekaro/core/fy`.
- Year close carries forward balance-sheet ledger balances and closing stock as opening entries (AC-10).
