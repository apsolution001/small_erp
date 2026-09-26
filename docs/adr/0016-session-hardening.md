# 0016 — Session hardening after the T-104 security review

**Status:** Accepted · 2026-09-26 · supersedes parts of ADR 0006 and ADR 0015 (named below)

## Context

The security review of T-104 found that:

- An access token could mint a new session through `switch-tenant` after its session had ended (logout, reuse detection), for up to 15 minutes.
- A logout racing a refresh could leave a live refresh token in a revoked family.
- Sessions never ended: every rotation slid the 30-day expiry forward.
- The access cache could store a snapshot loaded before an invalidation, after that invalidation.
- The lockout lived on `users`, so only registered emails locked, which told an attacker which emails exist.
- Failed queries reached the logs with their SQL and parameters (bcrypt hashes, emails, token hashes).

## Decision

1. **A session is a `sessions` row** (platform table, forced RLS, `ekaro_platform` only): `id` (= refresh-token `family_id` = the access token's `sid`), `user_id`, `membership_id`, `created_at`, `absolute_expires_at`, `revoked_at`, `revoked_reason`. `refresh_tokens.family_id` references it, and `refresh_tokens` no longer repeats the user and membership. `(membership_id, user_id)` references `memberships (id, user_id)`, and `replaced_by_id` references `refresh_tokens`.
2. **Lock order: session, then token.** Rotation, logout, reuse detection and switch-tenant lock the `sessions` row `FOR UPDATE` before the token row. A revoked session refuses rotation, so a family can never gain a live token after its revocation.
3. **Lifetimes** (supersedes the 30-day sliding expiry of ADR 0006 and ADR 0015 §5): a session ends `SESSION_ABSOLUTE_DAYS` (30) after login whatever the activity. A refresh token, and so the cookie, expires `SESSION_IDLE_DAYS` (7) after it was issued, capped at the absolute end: `expires_at = min(now + idle, absolute_expires_at)`. Switch-tenant keeps the old session's absolute end.
4. **Switch-tenant needs the refresh cookie** (supersedes ADR 0015 §5 on switching). In one transaction it locks the cookie's session and token, requires both live and the session to be the access token's `sid`, revokes it (`switched`) and starts the new session. No cookie, a cookie of another session, an ended or reused session: 401 and the cookie is cleared. A revoked token is still reuse (`REFRESH_REUSED`). A tenant the user does not belong to stays 403 and leaves the session as it was.
5. **Cookie name.** When `REFRESH_COOKIE_SECURE` is true (every deployed environment), the cookie is `__Secure-ekaro_refresh`. Browsers accept that prefix only from https with `Secure`, so an http page of the same site cannot plant it. Local http development keeps `ekaro_refresh`.
6. **Lockout in Redis, per email.** Five consecutive failures (each within 24 hours of the last) lock the email for 15 minutes. The keys are a keyed pseudonym of the normalised email, so an unknown email locks exactly like a registered one and no email is stored in Redis. A locked attempt still spends a bcrypt comparison. The 423 `ACCOUNT_LOCKED` of spec 01 is kept. `users.failed_login_count` and `users.locked_until` are dropped.
7. **Pseudonyms** are HMAC-SHA256 with a key derived by HKDF from `DATA_ENCRYPTION_KEY` (label `ekaro:pseudonym:v1`), truncated to 128 bits. They are used for the lockout keys and for emails and IPs in security events. Rotating `DATA_ENCRYPTION_KEY` resets lock counters and breaks correlation with older log lines; nothing else depends on them.
8. **Security events** are structured `warn` lines `{event, userId?, familyId?, ipHash?, emailHash?, reason?}` for `auth.login_failed`, `auth.lockout`, `auth.refresh_reused`, `auth.access_revoked`, `auth.disabled_account` and `auth.switch_denied`. Never an email, a password or a token.
9. **Access cache generations** (refines ADR 0015 §4). Each tenant has a generation counter next to its cache hash (same Redis hash tag). The invalidation hooks increment it with the delete. A loader reads it before its database load and writes the entry only if it is unchanged (one Lua script). The hooks keep their signatures and never throw: a failure after commit is logged, and the entry still expires within 60 seconds. Login, refresh and switch read fresh and no longer write the cache.
10. **Error logging.** The pino `err` serializer and `ProblemDetailsFilter` reduce a `DrizzleQueryError`, a pg `DatabaseError`, or an error caused by one, to `{type, sqlstate, constraint, table, column}`. The SQL, its parameters, the driver message, `detail` and the stack are never logged. Other errors keep type, `code`, `status`, message and stack, and their causes are reduced the same way.
11. **Smaller rules:**
    - Tenant-selection tokens carry a `jti` and are single-use (Redis `SET NX` until they expire). Token payload schemas require `exp`.
    - A login password over 72 UTF-8 bytes is a 422 `VALIDATION_FAILED`, like signup (bcrypt ignores the rest).
    - The guards deny non-HTTP contexts. The app refuses to boot when a route resolves to more than one of `@Public()`, `@Authenticated()` and `@RequirePermission()`.
    - Rate limits count an IPv6 client by its /64 and an IPv4-mapped address as its IPv4 address.
    - Production refuses `GSP_PROVIDER=mock` and an unset `TRUST_PROXY_HOPS`.
    - A GSP failure in the public GSTIN lookup is 503 `SERVICE_UNAVAILABLE`.
    - `ekaro_platform` loses SELECT on `godowns`, `units`, `tax_rates` and `document_series` (the bootstrap only inserts into them).

## Consequences

- An access token can no longer create a session once its own session has ended. Its remaining window (at most 15 minutes, 60 seconds after an access-cache invalidation) only reaches the routes it already could.
- Users sign in again at least every 30 days, and after 7 days without using the app.
- Anyone can lock any email for 15 minutes with five wrong passwords, registered or not. This is the accepted cost of the spec 01 lockout. The per-email and per-IP rate limits bound how fast it can be done, and the 423 reveals nothing about the account.
- The web (T-150) must send the refresh cookie with `switch-tenant` (`credentials: 'include'`) and treat its 401 like a failed refresh.
