# 0002 — Technology stack

**Status:** Accepted · 2026-09-26

## Decision
| Concern | Choice | Reason |
| --- | --- | --- |
| Runtime | Node.js 22 LTS | LTS until 2027-04; BRD: one language across the stack |
| Language | TypeScript 6 (strict) | Latest version supported by typescript-eslint |
| API framework | NestJS 12 (Express adapter) | BRD §11; DI + modules match the modular monolith |
| DB | PostgreSQL 16 (managed, India region) | BRD §11; RLS, strong transactions, numeric types |
| ORM | Drizzle ORM + drizzle-kit | SQL-transparent, first-class RLS/policies, no hidden queries, typed (ADR 0004) |
| Validation | Zod 4 via a custom Nest pipe | Same schemas in the web (ADR 0013). nestjs-zod does not support Nest 12 yet, and the pipe is about 20 lines |
| Request context | nestjs-cls + @nestjs-cls/transactional (Drizzle adapter) | Transaction and tenant context without passing `tx` everywhere |
| Jobs | Redis 7 + BullMQ 5 | BRD §11 |
| Logging | Pino (nestjs-pino) | Structured JSON, fast, redaction |
| Web | React 19 + Vite | BRD §11 |
| Routing | TanStack Router | Fully type-safe routes and search params (filters are central in ERP lists) |
| Server state | TanStack Query | Caching and invalidation standard |
| Tables | TanStack Table (+ virtualisation) | Headless, and handles large ERP grids |
| UI kit | shadcn/ui (Radix) + Tailwind CSS 4 | We own the code, it is accessible, and dense desk UIs are easy to theme |
| Forms | react-hook-form + Zod | Fast with large line-item forms |
| Tests | Vitest, supertest, Playwright | Fast, and one runner across the repo |
| Lint/format | ESLint 9 flat config + typescript-eslint, Prettier | Industry default |
| PDFs | Server-side HTML → PDF (Playwright/Chromium in the worker) | Branded invoices with the same templates as web preview |

## Rejected
- **Prisma:** RLS needs per-transaction `set_config`, which is awkward in Prisma. Its heavy engine and weaker control over SQL also count against it.
- **TypeORM:** the maintenance trajectory and type-safety are weaker.
- **Next.js:** SEO and SSR bring nothing to an authenticated ERP. A plain SPA is simpler to host and cache.
- **MUI / AntD:** they are heavier and harder to make dense and keyboard-first to our taste. With shadcn we own the components.
