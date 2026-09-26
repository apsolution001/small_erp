---
paths:
  - "apps/api/**"
---
# API rules (full text: docs/standards/backend.md, database.md, security.md)

- Module layout: controller → service → repository → schema. Cross-module access only through exported services or events.
- Every route has `@RequirePermission(...)` or a justified `@Public()`. Input is parsed with `ZodValidationPipe` and a schema from `@ekaro/contracts`.
- Tenant code uses `TransactionHost` only. Never touch the root pool. Never read `tenant_id` from request input.
- New tenant table checklist: `tenant_id`, audit columns, `version`, RLS enable + force + policy, grants to `ekaro_app`, `audit_row_change` trigger, isolation e2e test.
- Errors are `DomainError` subclasses with a stable `code`, rendered as problem+json.
- Env only via `src/config/env.ts`. Logs via Pino with redaction.
