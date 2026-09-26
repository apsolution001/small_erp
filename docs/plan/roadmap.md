# Delivery plan

Follows BRD §15.2: six 2-week sprints from October 2026, launch late December 2026. **Scope guard:** "Should" items slip to the first update. Launch never slips for them.

| Sprint | Weeks | Deliverable | Task range |
| --- | --- | --- | --- |
| 0 | pre-sprint | AI setup, standards, ADRs, specs 01–02, monorepo, CI | T-000..T-009 |
| 1 | 1–2 | Architecture, multi-tenancy, auth, roles, masters, UI kit | T-100..T-199 |
| 2 | 3–4 | Posting engine, inventory, approvals, purchase cycle | T-200..T-299 |
| 3 | 5–6 | Sales cycle, invoice PDFs, chart of accounts, vouchers | T-300..T-399 |
| 4 | 7–8 | Production (BOM, WO, job work), GSP integration (e-invoice, e-way bill) | T-400..T-499 |
| 5 | 9–10 | GST reports, bank reco, dashboard, Excel + Tally import, Tally sync | T-500..T-599 |
| 6 | 11–12 | Pilot with 3 customers, hardening, billing, launch | T-600..T-699 |

## Order of work inside a sprint
1. Spec task (spec written, then reviewed by the accounting-reviewer for money/GST areas).
2. `packages/contracts` + `packages/core` changes (shared foundations first).
3. **Server** tasks (schema → service → API → e2e).
4. **Client** tasks (screens on top of the finished API).
5. Sprint hardening: review, integrity checks, demo.

## Parallelism
Tasks in the same sprint that touch different modules run in parallel (one senior-coder agent each, in isolated worktrees). Shared files (`schema.ts`, `app.module.ts`, contracts index, permissions) are merged by the lead after each wave.
