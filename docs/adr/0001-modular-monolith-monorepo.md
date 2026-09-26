# 0001 — Modular monolith in a pnpm/Turborepo monorepo

**Status:** Accepted · 2026-09-26

## Context

A team of 3–4 must ship six ERP modules in 12 weeks (BRD §15). The modules share one database transaction: a sales invoice touches stock, ledgers and GST in the same commit. Microservices would add distributed transactions and operational cost with no benefit at this scale (1,000 tenants).

## Decision

- There is one deployable NestJS API. Each business area is a Nest module with strict boundaries: its own tables, services and events, and a public `index.ts`.
- A single monorepo (pnpm workspaces + Turborepo) holds `apps/api`, `apps/web`, `packages/contracts` and `packages/core`. Later it will also hold `apps/worker` (the same codebase with a different entrypoint) and `apps/tally-connector`.
- ESLint `import/no-restricted-paths` rules enforce the boundaries.

## Consequences

- Atomic cross-module transactions and simple ops.
- A module can be extracted later because boundaries and events already exist.
- The build is one CI pipeline, and Turborepo caching keeps it fast.
