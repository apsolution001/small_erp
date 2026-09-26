# Security standards

Baseline: OWASP ASVS L2 and the OWASP API Top 10. Personal data is handled under the DPDP Act 2023.

- **Transport:** HTTPS only. HSTS, a strict CSP and `helmet` defaults. CORS is allowed only for the web origin.
- **Passwords:** bcrypt with cost 12 (BRD §10). Minimum 10 characters, checked against a common-password list. Login uses generic error messages.
- **Sessions:** an access JWT (15 min, `aud`/`iss` checked, HS256 key from env, rotated by `kid`) plus a refresh token (opaque, 256-bit random, **stored hashed**, 30 days, rotated on every use). Reuse detection revokes the whole token family. The refresh cookie is `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
- **2FA:** TOTP (RFC 6238), optional per user, enforceable per tenant. Recovery codes are stored hashed.
- **Rate limiting:** auth endpoints are limited per IP and per account (`@nestjs/throttler` on a Redis store). Lock out progressively after repeated failures.
- **Authorization:** deny by default. Every route declares a permission. Branch scope is enforced in services for branch-scoped data.
- **Tenant isolation:** RLS (see database standard), plus isolation tests in CI.
- **Support access** (BRD §8.2): only with the customer's time-limited consent grant. Every action is logged with the support agent's identity.
- **Input:** Zod on every boundary. Uploaded files are checked for type and size and stored in object storage, never on the local disk of the API.
- **Secrets:** only in env or a secret manager. Never in code, logs or error messages.
- **Dependencies:** `pnpm audit` runs in CI and Renovate keeps dependencies updated. Lockfile committed.
