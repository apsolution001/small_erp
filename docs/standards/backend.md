# Backend standards (`apps/api`)

## Architecture

- **Modular monolith.** There is one Nest module per business area under `src/modules/<area>`. A module owns its tables, its services and its events.
- **Cross-module access** goes only through a module's exported service (its public API) or through domain events. Never import another module's repository or schema to write to it. You may read another module's tables only through its exported query service.
- **Layers inside a module** (dependencies point downward only):

```
<area>/
  <area>.module.ts
  <entity>/
    <entity>.controller.ts     HTTP only: parse via contracts schema, call service, map result
    <entity>.service.ts        use-cases, transactions, permission-independent business rules
    <entity>.repository.ts     Drizzle queries only; returns plain objects
    <entity>.schema.ts         Drizzle table definitions (+ RLS policy)
    <entity>.events.ts         event payload types published by this entity (if any)
    <entity>.service.spec.ts   unit tests (pure rules, mocked repository)
  index.ts                     the module's public exports
```

- Put pure calculations (GST, rounding, valuation, FY) in `packages/core`, not in services.

## Controllers

- Use REST, versioned under `/api/v1`. Resource names are plural kebab-case: `/api/v1/items`, `/api/v1/parties/:id`.
- Validate every input with `ZodValidationPipe` and a schema from `@ekaro/contracts`. Never use class-validator DTOs.
- Every route declares its permission with `@RequirePermission('<module>.<resource>:<action>')`. Only `@Public()` routes (signup, login, refresh, health) may skip it, and each needs a justification comment.
- Return contract-typed objects. Never leak Drizzle rows that carry internal columns.
- Lists are paginated with `?page=&pageSize=` (default 25, max 200) plus `?sort=field:asc` and `?q=`. The response is `{ data, meta: { page, pageSize, total } }`.
- Status codes: 201 on create, 200 on read and update, 204 on delete, 409 on a conflict or illegal state transition, 422 on a business-rule violation.
- Optimistic concurrency: mutable records carry `version int`. Updates send `version`, and a mismatch returns 409.
- `Idempotency-Key` header is required on document post/create endpoints that have external side effects (invoice post, e-invoice, payment).

## Errors

- Throw `DomainError` subclasses (`NotFoundError`, `ConflictError`, `BusinessRuleError`, `ForbiddenError`) from `src/common/errors`. The global filter maps them to RFC 9457 `application/problem+json`: `{ type, title, status, detail, code, errors? }`.
- `code` is a stable SCREAMING_SNAKE identifier (for example `CREDIT_LIMIT_EXCEEDED`). The web maps codes to messages.
- Never swallow errors. Never return 500 for a user error. Never put stack traces in responses.

## Transactions & tenancy

- Every authenticated request runs inside one DB transaction opened by `TenantTxInterceptor`. It sets `app.tenant_id`, `app.user_id` and `app.request_id` with `set_config(..., true)`.
- Repositories get the current transaction through `TransactionHost` (`@nestjs-cls/transactional`). **Never** use the root pool directly in tenant code.
- Platform code (signup, login, tenant admin) that must work across tenants uses `PlatformDb` (role `ekaro_platform`), and only from `modules/platform` and `modules/auth`. The dependency lint rule enforces this.
- Background jobs set tenant context explicitly with `runInTenant(tenantId, userId, fn)`.

## Events & jobs

- In-process domain events use `@nestjs/event-emitter`. Handlers that must be durable (email, e-invoice, Tally sync) write to the `outbox` table in the same transaction. A worker relays outbox rows to BullMQ.
- Job processors are idempotent and retry with exponential backoff. They must be safe to run twice.

## Configuration & logging

- All env vars are validated at boot by a Zod schema in `src/config/env.ts`. The process exits on invalid config. Code never reads `process.env` anywhere else.
- Logging is structured Pino JSON with `requestId`, `tenantId` and `userId`. Never log passwords, tokens, OTPs, full GSTIN-linked personal data or request bodies of auth routes (the redaction list is in the logger config).

## Style

- Enable TypeScript `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. `any`, non-null `!` on external data and `@ts-ignore` are not allowed.
- Names: files kebab-case, classes PascalCase, DB columns snake_case, TS properties camelCase (Drizzle maps them).
- Functions stay small and do one thing. Prefer pure functions. Services receive dependencies by constructor injection only.
- Comments explain _why_, not _what_. A public service method gets a one-line TSDoc when its behaviour is not obvious.
