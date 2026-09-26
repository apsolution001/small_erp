# Specifications

Specs are written **before** implementation. A sprint starts with its spec task (for example T-200), which turns BRD rows into data model, flows, rules and acceptance criteria. Implementation tasks link to spec sections.

| Spec                                                  | Scope                                                                                          | BRD                         | Status           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------- | ---------------- |
| [01-platform-auth-access](01-platform-auth-access.md) | tenants, signup, auth, roles, memberships, audit                                               | MS-01, §8, PL-04            | Approved         |
| [02-masters](02-masters.md)                           | company, branches, godowns, units, tax rates, categories, items, parties, series               | MS-01..06                   | Approved         |
| 03-posting-inventory                                  | posting engine, stock ledger, valuation, transfers, adjustments, batches, reorder, stock count | IN-01..07, §11 design rules | Sprint 2 (T-200) |
| 04-approvals                                          | approval rules, requests, self-approval guard                                                  | PL-03, §8 rules             | Sprint 2 (T-200) |
| 05-purchase                                           | PR → PO → GRN → PI (3-way), returns/debit notes, rate history                                  | PU-01..05                   | Sprint 2 (T-200) |
| 06-sales                                              | quotation → SO → DC → invoice, direct invoice, credit check, returns/credit notes, PDF + email | SA-01..06                   | Sprint 3 (T-300) |
| 07-accounts                                           | CoA, vouchers, auto-posting maps, bill-wise, ageing, bank reco, FY close, TDS                  | AC-01..05, 09..11           | Sprint 3 (T-300) |
| 08-production                                         | BOM, work orders, issue, output/scrap, job work ITC-04, costing                                | PR-01..06                   | Sprint 4 (T-400) |
| 09-gst                                                | GSP port, e-invoice, e-way bill, GSTR-1/3B, 2B reco                                            | AC-06..08                   | Sprint 4 (T-400) |
| 10-import-tally                                       | Excel import/export, Tally masters/opening import, voucher sync                                | TI-01..04                   | Sprint 5 (T-500) |
| 11-reports-dashboard-notifications                    | owner dashboard, reports, exports, emails, global search                                       | PL-01, 02, 05, 06           | Sprint 5 (T-500) |
