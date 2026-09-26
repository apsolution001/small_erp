# 0017 — Web session and data layer

**Status:** Accepted · 2026-09-26 · applies ADR 0006, 0013, 0015 and 0016 to `apps/web` (T-150)

## Context

T-150 builds the web foundation on top of the T-104 auth API. Some things in it have to be decided once, for every screen that follows:

- Where the session lives, and how the router, TanStack Query and React see it.
- How the web honours ADR 0015's "a refresh cookie presented twice ends the session", when several requests, and several tabs, can find the access token expired at once.
- How it reacts to ADR 0016's session rules: switch-tenant needs the live cookie, the selection token is single-use, and sessions end after 7 idle or 30 days.
- What the web does with API errors and responses that break the contract.
- How a user with several companies switches between them, when the API has no endpoint that lists a user's companies.

## Decision

1. **One `ApiClient` owns the transport and the access token.** It keeps the token in memory only (ADR 0006), sends `credentials: 'include'` on every call, and parses every response with its contracts schema. A response that fails its schema is an `ApiError` with the code `INVALID_RESPONSE`, never data. Error bodies that are `problemSchema` documents become `ApiError { status, code, message, fieldErrors, requestId }`. Other failures map by status, and a failure with no response is `NETWORK_ERROR` (status 0). For `RATE_LIMITED` and `INTERNAL_ERROR` the web shows its own words, because the server's detail for those is technical.
2. **Refresh is single-flight and serialised across tabs.** A 401 on an authenticated call triggers `refreshSession()`. Concurrent callers share one promise, and the refresh runs inside a Web Locks lock (`ekaro.auth.refresh`), so two tabs never present the same cookie. The original call is retried once. If the token changed while it was in flight, it is retried without a new refresh. A refused refresh clears the token and emits `expired`. A refresh that fails on the network does not end the session.
3. **An `AuthController`, outside React, owns the session lifecycle:** restore on load, login (with tenant selection), signup, switch-tenant and logout. `main.tsx` starts the restore before the first render, so StrictMode never sends it twice. React reads the controller with `useSyncExternalStore`. `/auth/me` lives in the query cache (`authKeys.me()`), and `useCan` reads its `permissions`. The router gets the controller in its context. `_app`'s `beforeLoad` redirects to `/login?redirect=<path>` when there is no session, and `/login` and `/signup` redirect a signed-in user onwards. The app calls `router.invalidate()` on every controller change, so login, logout and expiry route themselves through the same guards. `redirect` must be an internal path (`/…`, never `//host`).
4. **Every refused session ends the same way.** Whether a refresh is refused (expired, idle, reused, revoked) or a switch-tenant finds no live session behind the cookie (401), the client's refresh fails, the controller signs the user out with the reason `expired`, and the guard shows login saying so. A 403 on switch-tenant leaves the session alone. The selection token is single-use, so any failed pick goes back to the login form rather than retrying.
5. **Switching company empties the cache.** After `switch-tenant`, every non-auth query is removed, not just invalidated, so rows from the old company can never render under the new company's name. `/auth/me` is then fetched fresh, and the user lands on the dashboard. Login and signup also start from an empty cache.
6. **The company list for the switcher is the one login offered.** `requiresTenantSelection` returns the user's companies. The web keeps them, plus the current company, in `sessionStorage` (names and ids only, validated with the contracts schema on read), so the switcher survives a reload in that tab. A user who logs straight into their only company sees just that one. This is replaced by a query once the API offers `GET /auth/tenants` (T-150 follow-up).
7. **Keyboard shortcuts go through one registry** (`lib/hotkeys`), which also feeds the `?` help. `mod` means Ctrl, or ⌘ on macOS. Bare keys never fire inside a text field. Shortcuts can be limited to a scope (the focused form), and entries without a handler document element-level keys (table arrows, Enter in forms).

## Consequences

- Every screen gets typed data, one error shape (`ApiError`) for toasts and forms, and silent refresh, without writing any of it.
- The start-up restore costs one `POST /auth/refresh` per page load. A visitor with no cookie sees a 401 in the browser console, which is expected.
- In a new tab, a multi-company user's switcher lists only the current company until they sign in through the picker or the API grows `GET /auth/tenants`.
- Browsers without Web Locks (old ones) fall back to in-tab single flight. Two such tabs could still race and be signed out, which is safe but inconvenient.
