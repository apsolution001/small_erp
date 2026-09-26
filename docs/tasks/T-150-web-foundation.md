---
id: T-150
title: 'Web foundation: app shell, UI kit, API client, auth screens, hotkeys'
status: done
sprint: 1
area: client
depends_on: [T-104]
spec: docs/standards/frontend.md, docs/specs/01-platform-auth-access.md
---

## Scope

- Vite + React 19 + TS, Tailwind 4, shadcn/ui primitives (button, input, select, dialog, sheet, dropdown, table, form, toast/sonner, tabs, badge, command, tooltip, popover, calendar), and the design tokens (light and dark).
- TanStack Router (file-based) + Query. `lib/api-client.ts` (contract-parsed responses, problem → ApiError, silent refresh). `lib/auth` (in-memory token, `useAuth`, `useCan`).
- Screens: signup (GSTIN auto-fill via lookup), login (+ tenant picker), and the authenticated shell with a collapsible sidebar, a top bar with tenant switcher, FY badge and user menu, and a command palette (Ctrl+K).
- Shared components: `DataTable` (server pagination, sorting, search, column visibility, keyboard row navigation), `PageHeader`, `FormField`, `MoneyInput`, `QtyInput`, `StateSelect`, `GstinInput`, `ConfirmDialog`, and `EmptyState` / `ErrorState`.
- `lib/hotkeys` registry + `?` help dialog. `lib/format` (INR, qty, dates as dd-MMM-yyyy).

## Acceptance criteria

A user can sign up, is logged in, sees the dashboard shell, can refresh the page and stay logged in (silent refresh), and can log out. Unit tests cover the api-client refresh logic, MoneyInput and format.

## Decisions

The architectural ones are in [ADR 0017](../adr/0017-web-session-data-layer.md). In short:

1. **Session:** `ApiClient` keeps the access token in memory and sends `credentials: 'include'` on every call. A 401 triggers one refresh, shared by concurrent callers and serialised across tabs with a Web Lock, because the API ends a session whose cookie is presented twice. The call is then retried once. `AuthController`, outside React, restores the session before the first render and owns login, selection, signup, switch and logout. `/auth/me` lives in the query cache, and `useCan` reads its permissions. Route guards read the controller, and every session change re-runs them.
2. **Errors:** every response is parsed with its contracts schema (`INVALID_RESPONSE` on drift). Problem documents become `ApiError` with `code`, `status`, `fieldErrors` (by dotted path) and `requestId`. For `RATE_LIMITED` and `INTERNAL_ERROR` the web uses its own words, because the server's text there is technical (the API's 429 detail reads "ThrottlerException: Too Many Requests").
3. **Switching company** empties the query cache instead of only invalidating it, so the old company's rows never show under the new name. The user then lands on the dashboard.
4. **Company list for the switcher:** the API has no "my companies" endpoint, and changing `apps/api` was out of bounds for this task. The list is what login's `requiresTenantSelection` offered, plus the current company, kept per tab in `sessionStorage` (names and ids only). A follow-up swaps it for `GET /auth/tenants`.
5. **After the T-104 hardening:**
   - The picker never retries a single-use selection token; any failure returns to login with the reason.
   - A 401 from switch-tenant ends the session through the failed refresh. A 403 keeps the session.
   - An unavailable GSTIN lookup (503, rate limit, offline) is a non-blocking note, and signup can still proceed. Signup has no manual company fields: the API fetches the company from the GSP when the account is created.
6. **Forms:** the contracts schema is the resolver (`formResolver`), with plain-language messages for zod's generic issues. A message written in the schema always wins. Enter moves to the next field and submits from the last one. `useFormShortcuts` binds Ctrl+S and Esc to the focused form. Server field errors go onto their fields (`applyServerErrors`), and the rest goes to a form alert.
7. **Money and quantities:**
   - `MoneyInput` takes rupees and emits a paise string through `Money.fromRupees`. It accepts at most 2 decimals and 15 rupee digits, shows Indian grouping when not focused, and accepts pasted grouped amounts.
   - `QtyInput` limits input to the unit's decimals and emits canonical decimal text (`007.50` → `7.5`).
   - No JS number ever carries either value.
8. **Dates** display as `dd-MMM-yyyy`. Calendar dates are shown as they are, and instants are read in IST. `Intl` renders "Sept" in current ICU, so the month names are fixed.
9. **DataTable** uses TanStack Table **v9** (the installed major), with `useTable` and `tableFeatures({ rowSortingFeature, rowPaginationFeature, columnVisibilityFeature })`, plus manual sorting and pagination. The list state is local (`useDataTableState`), not in the URL; that is enough until a screen needs deep links. Page sizes stop at 200 (the contract maximum), so no page needs virtualising.
10. **Navigation:**
    - Nav items for screens that do not exist yet are shown disabled, marked "Soon", so users see the product map.
    - Items the role lacks are hidden (`useCan`), and empty groups disappear.
    - Transaction modules have no permission yet; they stay visible and disabled.
11. **shadcn/ui:** the registry host (ui.shadcn.com) is blocked by the proxy, so the CLI cannot run. The primitives are the new-york-v4 sources fetched from the shadcn GitHub repository and adapted to this repo's lint rules:
    - Variant helpers moved to their own module (`button-variants.ts`).
    - The CommandDialog title sits inside its content, so Radix links it.
    - `sonner` follows the app's own theme store, with no `next-themes`.
    - `components.json` is in place for future `shadcn add` runs.
12. **Env:** Vite keeps its default env directory (`apps/web`, e.g. `.env.local`). Pointing it at the root `.env` was tried and reverted: that file's `NODE_ENV=development` made the production build bundle development React (599 kB instead of 407 kB). With `VITE_API_BASE_URL` unset, the app calls `/api/v1` on its own origin, and the dev server proxies that to `API_PROXY_TARGET` (default `http://localhost:3000`), so `pnpm dev` works with no web env at all. `.env.example` says so.
13. **Lint:** the web ESLint config allows throwing TanStack Router's `Redirect` and `NotFoundError`, because that is how guards redirect. No inline disables were needed.

## Building a screen on this foundation (for T-151..T-154)

- **Route:** a thin file under `src/routes/_app/…`. It sits behind the guard automatically. Set `to` on its `NAV` entry in `features/shell/nav.ts`.
- **Data:** `features/<area>/api.ts` with a `keys` factory and `useQuery` / `useMutation` through `useApi()`. Parse with the contracts schema, e.g. `api.get('/parties', paginated(partyResponseSchema), { query })`. Mutations invalidate their keys and toast the document number.
- **List:** `const table = useDataTableState({ sort: [{ id: 'name', desc: false }] })`, then `useQuery({ queryKey: keys.list(table.query), placeholderData: keepPreviousData, … })`, then `<DataTable label="Parties" columns={columns} data={q.data?.data} rowCount={q.data?.meta.total} getRowId={(r) => r.id} {...table} isLoading={q.isPending} isFetching={q.isFetching} error={q.error ?? undefined} onRetry={() => void q.refetch()} onRowOpen={…} empty={<EmptyState … />} />`. Columns come from `dataTableColumns<T>()`, with `meta: { label, align: 'right' }` for amounts.
- **Form:** `useForm<z.input<S>, unknown, z.output<S>>({ resolver: formResolver(schema) })`, `<Form form onSubmit>`, then `<FormField name label render={({ field, control }) => …} />`. Controlled inputs use `value` / `onValueChange` (`MoneyInput`, `QtyInput`, `GstinInput`, `StateSelect`, `MobileInput`). Add `useFormShortcuts({ formRef, onSave, onCancel })`, and on error `setFormError(applyServerErrors(form.setError, error, FIELDS))`.
- **Permissions:** `useCan('masters.party:create')` hides or disables actions. Use `ConfirmDialog` for deletes and cancels.

## Plan

- [x] shadcn/ui setup (components.json, tokens light/dark, primitives), theme store
- [x] `lib/api-client` + `ApiError`, `lib/auth` (controller, provider, hooks), query client defaults, env
- [x] `lib/hotkeys` (registry, provider, form keys), `lib/format`, `lib/forms`, numeric codecs, GSTIN check
- [x] Shared components: DataTable, PageHeader, Form/FormField, MoneyInput, QtyInput, StateSelect, GstinInput, MobileInput, PasswordInput, ConfirmDialog, EmptyState/ErrorState, FormAlert
- [x] Routes: `(auth)/login` (+ tenant picker), `(auth)/signup` (GSTIN auto-fill), `_app` guard, `_app/index` dashboard with the onboarding checklist; root not-found/error
- [x] Shell: collapsible sidebar with gated nav, mobile sheet, top bar (tenant switcher, FY badge, trial end, user menu), command palette, `?` help
- [x] Tests (Testing Library + mocked fetch), manual smoke with Playwright against the API
- [x] Merged the T-104 security fixes and adapted (switch cookie, single-use selection, GSP 503)
- [x] ADR 0017, task board

## Verification

Run on 2026-09-26 after merging `claude/brave-dirac-k9ikzp` (T-104 security fixes), with local Postgres 16 and Redis 7.

- `pnpm format` then `pnpm format:check`: clean. `pnpm lint`: 4/4 successful. `pnpm typecheck`: 4/4 successful. `pnpm build`: 4/4 successful (web: 407 kB main chunk, 130 kB gzip; routes are code-split).
- `pnpm test`: core **127**, contracts **292**, api **142**, web **78** passed. Web, 10 files:
  - `lib/api-client.test.ts` (15):
    - Bearer + `credentials: 'include'`; query strings; 204.
    - Problem → `ApiError` (code, status, first message per field path, requestId); friendly text for 429; non-problem 502/404; network → `NETWORK_ERROR`; contract drift → `INVALID_RESPONSE`.
    - 401 → one refresh → retry with the new token; three concurrent 401s → **one** refresh; no second refresh when the token already changed; retry only once; a refused refresh (`REFRESH_REUSED`) → token cleared, `expired` event, no retry; a network failure keeps the session; the cross-tab lock wraps the refresh.
  - `lib/format.test.ts` (9): INR grouping including a full `bigint`, qty half-up with grouping and sign, dd-MMM-yyyy (IST for instants), invalid input.
  - `lib/hotkeys/registry.test.ts` (9): mod mapping, Shift on symbols, alternatives, formatting, latest-wins, text-field rule, scopes, listing, window binding.
  - `components/money-input.test.tsx` (9): typed rupees → paise per keystroke, 15-digit amounts exact, third decimal, letters and minus refused, negatives on request, grouped display on blur, pasted grouped amounts, reset from outside; QtyInput decimals and grouping.
  - `components/gstin-input.test.tsx` (5): every check status; upper-casing and length; the valid state linked by `aria-describedby`; checksum error; countdown.
  - `components/data-table/data-table.test.tsx` (9): formatted, right-aligned cells; server paging and sort (back to page 1, `aria-sort`); debounced search; arrow keys + Enter open; column hiding; loading, empty, no-match and error-with-retry states.
  - `features/auth/guards.test.tsx` (5): no session → `/login?redirect=/`; restore from the cookie; a signed-in user leaves login and an external `redirect` is ignored; logout → login with no redirect and the token cleared; a refused refresh mid-session → login with "session has ended".
  - `features/auth/forms/login-form.test.tsx` (7): schema validation before any call; the 72-byte limit; Enter to the next field, then the normalised payload `{email lower-cased, password}` with credentials; the server message on 401; the tenant picker → select-tenant payload and the company list kept; a single-use token is never retried; an expired token → back to login.
  - `features/auth/forms/signup-form.test.tsx` (4): GSTIN auto-fill (legal name, state, status) then the exact signup payload (`+91` mobile, lower-cased email, `acceptTerms: true`) → dashboard; a Cancelled GSTIN blocks submit; a GSP 503 is non-blocking; a server 422 on `password` lands on the field.
  - `features/shell/app-shell.test.tsx` (6): company, FY and role-gated nav (a Viewer has no Settings); switching empties the cache and shows the new company; switch 401 → login without a toast; switch 403 keeps the session; Ctrl+K palette navigation; the `?` help lists the registered shortcuts.
- **Manual smoke** (Playwright on the preinstalled Chromium 1194, 1366×768):
  - The API was built and run on :3100 against `ekaro_web`, migrated fresh, with `APP_ORIGIN=http://localhost:5174` and `NODE_ENV=development`. The auth throttle limits were raised through env, because the local Redis and 127.0.0.1 are shared with other sessions: the first run hit 429 from their traffic.
  - The web ran on :5174 with `VITE_API_BASE_URL=http://localhost:3100/api/v1`.
  - **12/12 checks passed**, before and after the merge:
    1. An anonymous visit redirects to `/login?redirect=/`.
    2. The GSTIN `27AAPFU0939F1ZV` auto-fills "AAPFU0939F and Associates, Active, Maharashtra".
    3. Signup lands on the dashboard.
    4. The top bar shows the company and "FY 2026-27".
    5. A reload stays signed in (silent refresh).
    6. Ctrl+K opens the palette.
    7. `?` opens the help.
    8. Logout goes to `/login` with no redirect.
    9. A reload after logout stays signed out.
    10. Login with the email upper-cased works.
    11. There is no horizontal scroll at 1366×768.
    12. There are no console errors other than the expected 401s of the anonymous start-up refresh.
  - Screenshots (session scratchpad `screens/`): 01-login, 02-signup-filled, 03-dashboard, 04-dashboard-after-reload, 05-command-palette, 06-shortcuts-help, 07-logged-out, 08-dashboard-dark, 09-sidebar-collapsed.
- Review: the `code-reviewer` agent could not be invoked from this sub-agent session (no agent tool). A self-review against the frontend, security and testing standards was done instead. Run `code-reviewer` on this branch before merging.

## Follow-ups

- **API (a new task, or T-105):**
  - Add `GET /auth/tenants` (`@Authenticated`), returning the user's active memberships as `TenantChoice[]`; the service already has `choicesOf`. The web then swaps `lib/auth/tenant-choices.ts` for a query.
  - The 429 problem `detail` is "ThrottlerException: Too Many Requests"; give it a user-facing sentence.
- **Local dev:** throttling keys on the client IP in a Redis shared by every local API. Parallel sessions on one machine can exhaust each other's auth limits; consider a per-instance key prefix.
- **T-151..T-154:** set `to` on the `NAV` entries as screens land. Add `useFormShortcuts`, and the unsaved-changes warning on navigation (frontend standard), to the first edit form. Keep list state in URL search params where deep links matter.
- **T-155:** a Playwright suite under `apps/web/e2e` can start from the smoke script's steps (signup → dashboard → reload → logout).
- **Onboarding checklist:** each step's real status and link arrive with its module (templates, import, opening balances, invitations in T-105/T-151, the first invoice).
