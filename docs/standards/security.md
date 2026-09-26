# Security standards

Baseline: OWASP ASVS L2 and the OWASP API Top 10. Personal data is handled under the DPDP Act 2023.

- **Transport:** HTTPS only. HSTS, a strict CSP and `helmet` defaults. CORS is allowed only for the web origin.
- **Passwords:** bcrypt with cost 12 (BRD §10). Minimum 10 characters, checked against a common-password list. Login uses generic error messages.
- **Sessions:** an access JWT (15 min, `aud`/`iss` checked, HS256 key from env, rotated by `kid`) plus a refresh token (opaque, 256-bit random, **stored hashed**, rotated on every use). A session ends 7 days after its last refresh (`SESSION_IDLE_DAYS`) and at the latest 30 days after login (`SESSION_ABSOLUTE_DAYS`) (ADR 0016). Reuse detection revokes the whole token family. Changes to a session lock its `sessions` row first. The refresh cookie is `__Secure-ekaro_refresh` (`ekaro_refresh` only for local http) with `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Switching tenant needs that cookie as well as the access token.
- **2FA:** TOTP (RFC 6238), optional per user, enforceable per tenant. Recovery codes are stored hashed.
- **Rate limiting:** auth endpoints are limited per IP and per account (`@nestjs/throttler` on a Redis store). IPv6 clients count per /64, IPv4-mapped addresses as IPv4. `TRUST_PROXY_HOPS` must be set explicitly in production. Lock out after repeated failures, per email in Redis, identically for unknown emails (5 failures → 15 minutes).
- **Security events:** login failures, lockouts, refresh-token reuse, revoked access, disabled-account attempts and refused tenant switches are logged as structured `warn` lines `{event, userId?, familyId?, ipHash?, emailHash?}`. Emails and IPs appear only as keyed pseudonyms (HMAC).
- **Authorization:** deny by default. Every route declares a permission. Branch scope is enforced in services for branch-scoped data.
- **Tenant isolation:** RLS (see database standard), plus isolation tests in CI.
- **Support access** (BRD §8.2): only with the customer's time-limited consent grant. Every action is logged with the support agent's identity.
- **Input:** Zod on every boundary. Uploaded files are checked for type and size and stored in object storage, never on the local disk of the API.
- **Secrets:** only in env or a secret manager. Never in code, logs or error messages. A failed query is logged only as `{type, sqlstate, constraint, table, column}`: never its SQL, parameters, driver message or `detail`. Test-only adapters (`GSP_PROVIDER=mock`) are refused in production.
- **Dependencies:** `pnpm audit` runs in CI and Renovate keeps dependencies updated. Lockfile committed.
