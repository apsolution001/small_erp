# Testing standards

Write the test first. A bug fix starts with a failing test that reproduces it.

| Layer | Tool | What | Where |
| --- | --- | --- | --- |
| `packages/core` | Vitest | every function, including edge cases (rounding, zero, negative, huge values); property tests for money | `*.test.ts` next to source |
| API unit | Vitest | service business rules with the repository mocked | `*.spec.ts` next to source |
| API integration | Vitest + supertest + real Postgres | HTTP → DB round trip, permissions, RLS isolation, posting correctness | `apps/api/test/**/*.e2e-spec.ts` |
| Web unit | Vitest + Testing Library | forms, hooks, formatting | `*.test.tsx` next to source |
| Web e2e | Playwright | critical journeys: sign up → first invoice; login; masters CRUD | `apps/web/e2e/` |

## Mandatory tests

- **Tenant isolation:** every new tenant table gets an e2e test showing that tenant B cannot read, update or delete tenant A's rows through the API **and** through a raw `ekaro_app` connection with B's context.
- **Permissions:** every endpoint has one allowed-role test and one denied-role test.
- **Posting:** every document that posts asserts the exact stock and GL rows it creates, that the voucher balances, and that cancel produces an exact reversal.
- **Money:** assert with exact paise values, never with approximate matchers.

## Rules

- Tests are deterministic. No real network (the GSP, email and Tally are faked behind their interfaces). Use a fixed clock where time matters.
- Each e2e test file creates its own tenant(s) through factories in `test/factories`, so tests are isolated and can run in parallel.
- Never skip or delete a failing test to get green. Fix the cause.
- Coverage gate: `packages/core` ≥ 95% lines. API services ≥ 80%.
