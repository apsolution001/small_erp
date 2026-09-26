# Ekaro

_Ek system. Poora business._ Cloud ERP for Indian MSMEs: inventory, purchase, sales, production and GST accounting in one web app.

- Product requirements: [`docs/brd.md`](docs/brd.md)
- Architecture: [`docs/architecture/overview.md`](docs/architecture/overview.md), decisions in [`docs/adr`](docs/adr)
- Engineering rules: [`CLAUDE.md`](CLAUDE.md) and [`docs/standards`](docs/standards)
- Work items: [`docs/tasks`](docs/tasks/README.md)

## Quick start

```bash
nvm use && corepack enable
pnpm install
cp .env.example .env
pnpm dev:infra                     # or use local postgres/redis
bash apps/api/scripts/setup-local-db.sh
pnpm --filter @ekaro/api db:migrate
pnpm dev                           # api http://localhost:3000, web http://localhost:5173
```
