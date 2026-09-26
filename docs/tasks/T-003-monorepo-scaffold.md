---
id: T-003
title: Monorepo scaffold, tooling, local infra
status: done
sprint: 0
depends_on: [T-001]
spec: docs/adr/0001-modular-monolith-monorepo.md, docs/adr/0002-technology-stack.md
---

## Goal

A working pnpm + Turborepo monorepo with `apps/api`, `apps/web`, `packages/core` and `packages/contracts`, where `lint`, `typecheck`, `test` and `build` all run green from the root.

## Acceptance criteria

- Root: `package.json` (engines node 22, packageManager pnpm 10), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes), ESLint 9 flat config with typescript-eslint (type-checked) and module-boundary rules, Prettier, `.editorconfig`, `.gitignore`, `.nvmrc`, `.env.example`.
- `docker-compose.yml`: postgres 16, redis 7, mailpit, minio, plus `apps/api/scripts/setup-local-db.sh`, which creates the roles `ekaro_owner`, `ekaro_app` and `ekaro_platform` and the databases `ekaro` and `ekaro_test`. It works both with docker and with a local postgres.
- Each package builds and has one passing smoke test.
