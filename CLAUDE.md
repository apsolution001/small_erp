# Ekaro — cloud ERP for Indian MSMEs

*Ek system. Poora business.* A multi-tenant SaaS ERP that covers inventory, purchase, sales, production and GST accounting.
The product source of truth is [`docs/brd.md`](docs/brd.md). When the BRD and anything else disagree, the BRD wins. After it come the ADRs, then the specs.

## Read before you code

| When you… | Read |
| --- | --- |
| start any task | the task file in `docs/tasks/`, the spec it links, and `docs/architecture/overview.md` |
| touch `apps/api` | `docs/standards/backend.md`, `docs/standards/database.md` |
| touch `apps/web` | `docs/standards/frontend.md` |
| touch money, stock, GST or ledgers | `docs/standards/accounting.md` (mandatory) |
| write tests | `docs/standards/testing.md` |
| commit or open a PR | `docs/standards/git.md` |
| make a design decision not covered | `docs/adr/` — then add a new ADR; never decide silently |

## Stack (decided, see `docs/adr/`)

- **Monorepo:** pnpm workspaces + Turborepo, Node 22 LTS, TypeScript 6 strict.
- **API** `apps/api`: NestJS 12 modular monolith, Drizzle ORM on PostgreSQL 16, Zod 4 validation, nestjs-cls for request/tx context, Pino logs, BullMQ on Redis for jobs.
- **Web** `apps/web`: React 19 + Vite, TanStack Router / Query / Table, Tailwind CSS 4 + shadcn/ui (Radix), react-hook-form + Zod, keyboard-first shortcut layer.
- **Shared** `packages/contracts` (Zod API schemas + types, used by both apps) and `packages/core` (pure domain logic: money, quantity, GST, GSTIN, financial year).
- **Tests:** Vitest everywhere, supertest against a real Postgres for the API, Playwright for web e2e.

## Commands

```bash
pnpm install
pnpm dev:infra             # docker compose: postgres, redis, mailpit (or local services)
pnpm --filter @ekaro/api db:migrate
pnpm dev                   # api :3000 + web :5173
pnpm lint && pnpm typecheck && pnpm test   # must be green before every commit
pnpm --filter @ekaro/api test:e2e          # API integration tests (needs postgres)
```

## Non-negotiables (a PR that breaks one is rejected)

1. **Tenant isolation lives in the database.** Every tenant-owned table has `tenant_id uuid not null`, and RLS is **enabled and forced**. The API connects as `ekaro_app`, which has no `BYPASSRLS`. Never pass `tenant_id` from the client. It comes from the authenticated session only.
2. **Money is integer paise (`bigint`).** Never use float, never use `numeric` for amounts, never use JS `number` arithmetic on money outside `@ekaro/core/money`. Quantities are `numeric(20,6)` and are handled with `Decimal` from `@ekaro/core`.
3. **One posting engine.** Stock ledger and general ledger rows are written only by `modules/posting`. Nothing else inserts into `stock_ledger_entries` or `gl_entries`.
4. **Posted documents are immutable.** Nothing is ever hard-deleted after posting. You cancel it with a reversal entry. Lifecycle: Draft → Submitted → Approved → Posted → Cancelled (BRD §9.4).
5. **Every mutation is audited** (the DB trigger writes `audit_log` with old and new values, the user and the time). Never disable the trigger.
6. **Validation at the boundary** with Zod schemas from `@ekaro/contracts`, shared by API and web. No `any`. No unchecked casts of external data.
7. **No patchwork.** Fix root causes. If a design is wrong, write an ADR and change it properly. Never leave TODO hacks, commented-out code, skipped tests or `eslint-disable` without a linked reason.
8. **A user never approves their own document.** Approval thresholds are configurable per document type (PL-03).

## Workflow (spec → plan → TDD → verify → review)

1. Pick a task from `docs/tasks/` (`status: todo`, dependencies done). Set it to `in-progress`.
2. Re-read its acceptance criteria. If something is ambiguous, decide it using the BRD plus industry practice, and record the decision in the task file (and in an ADR if it is architectural).
3. Write the failing tests first (red → green → refactor).
4. Implement in small commits using Conventional Commits.
5. Run `pnpm lint && pnpm typecheck && pnpm test` (and `test:e2e` when you touched the API). Paste the evidence into the task file's *Verification* section. Never claim done without it.
6. Have the `code-reviewer` agent review the change (and `accounting-reviewer` when money, stock or GST changed). Fix every blocking finding.
7. Set the task to `done`.

## Agents & skills in this repo

- `.claude/agents/senior-coder.md`: implements a task file end-to-end following these rules.
- `.claude/agents/code-reviewer.md`: strict review against the standards.
- `.claude/agents/accounting-reviewer.md`: CA-grade review of GST, stock and ledger logic.
- `.claude/skills/implement-task`: the exact procedure for executing a task file.
- `.claude/skills/new-business-module`: scaffolding checklist for a new API + web module.
- The **Superpowers** plugin is enabled in `.claude/settings.json` (brainstorming, writing-plans, TDD, systematic-debugging, verification-before-completion). Use those skills.

## Repository map

```
apps/api            NestJS API (src/modules/<area>/..., db/migrations, test/)
apps/web            React app (src/routes, src/features/<area>, src/components)
packages/contracts  Zod schemas + inferred types for every endpoint
packages/core       pure, framework-free domain logic (100% unit tested)
docs/brd.md         business requirements (source of truth)
docs/adr            architecture decision records
docs/architecture   system overview, module map, data model
docs/specs          functional + technical specs per module
docs/standards      coding standards (backend, frontend, database, accounting, testing, git, security)
docs/plan           roadmap and sprint plan
docs/tasks          executable task files (one per unit of work)
```
