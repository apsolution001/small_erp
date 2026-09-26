# 0006 — Authentication: JWT access + rotating refresh tokens

**Status:** Accepted · 2026-09-26

## Decision

- Users are **global** (one login by email, plus a verified mobile). A user holds **memberships** in one or more tenants. An external CA serves many clients, so this is required.
- Login returns an **access JWT** (15 min, HS256, claims `sub`, `tid`, `mid` = membership, `sid` = session, `iss`, `aud`) in the body, and a **refresh token** in an httpOnly Secure SameSite=Strict cookie scoped to `/api/v1/auth`.
- Refresh tokens are opaque 256-bit random values, stored as SHA-256 hashes, rotated on every use, and grouped in a _family_. If a revoked token is presented, the whole family is revoked (reuse detection).
- Switching tenant issues a new access token for another membership of the same user.
- Passwords use bcrypt with cost 12 (BRD §10). Optional TOTP 2FA follows in Sprint 1b. Google sign-in (OIDC) links to an existing user by verified email.
- The access token is held in memory in the SPA and never in localStorage.

## Consequences

- XSS cannot exfiltrate the refresh token. CSRF is mitigated by SameSite=Strict plus the refresh endpoint only issuing tokens (no state change beyond rotation).
- The access token is stateless. A revoked session stays valid for at most 15 minutes, unless the session table is checked on sensitive routes, which we do for user management and billing.
