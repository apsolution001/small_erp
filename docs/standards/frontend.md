# Frontend standards (`apps/web`)

## Structure

```
src/
  main.tsx, router.tsx
  routes/                 TanStack Router file routes (thin: load data, render feature component)
  features/<area>/        api.ts (query/mutation hooks), components/, forms/, columns.tsx
  components/ui/          shadcn/ui primitives (generated, lightly customised)
  components/             app-wide composites (DataTable, PageHeader, MoneyInput, FormField, ...)
  lib/                    api-client, auth, hotkeys, format (money/date/qty), query-client
  styles/                 tailwind entry + design tokens
```

## Data

- The server is the state. Use TanStack Query for all server data, with query keys from a per-feature `keys` factory. Keep no server data in global stores.
- One typed API client in `lib/api-client.ts`. It parses every response with the Zod schema from `@ekaro/contracts` (fail loudly on contract drift) and maps `problem+json` into `ApiError`.
- Refresh the access token silently on 401 (one refresh in flight at a time). The access token lives in memory only. The refresh token is an httpOnly cookie.
- Mutations invalidate the queries they affect. After success, show a toast with the document number.

## Forms (the heart of an ERP)

- Use react-hook-form + `zodResolver` with the **same schema as the API** from contracts.
- Keyboard-first (BRD §5): `Enter` moves to the next field, `Ctrl+S` saves, `Esc` cancels, `Alt+N` adds a new line, and a line grid is navigable with the arrow keys. All shortcuts are registered through `lib/hotkeys` and listed in the `?` help dialog.
- Money is entered with `MoneyInput`: rupees in the UI and paise in the payload. Never do float arithmetic on it. Quantities use `QtyInput`. Numbers use Indian grouping (`12,34,567.00`) via `lib/format`.
- Show server validation errors (the `errors` array in the problem) on the matching fields.
- Warn about unsaved changes on navigation.

## UI

- Components come from shadcn/ui on Radix. Style them with Tailwind using design tokens (CSS variables) only. Do not use arbitrary hex colours in components.
- Two densities: **desk** (accountant: dense tables, keyboard) and **floor** (store and production: big touch targets, few fields). Choose per screen.
- Must work at 1366×768 (BRD §10). Tables virtualise above 200 rows.
- Accessibility: every input has a label, dialogs trap focus, colour is never the only signal, and contrast meets WCAG AA.
- Show every loading, empty and error state explicitly. No blank screens.

## Permissions

- The UI hides or disables actions the user lacks permission for, using `useCan('<perm>')`. It is a convenience only, because the API is the enforcement point.

## Style

- Use function components and hooks. No default exports except route files (the router requires them).
- Keep components small. When a file passes about 200 lines, split out hooks or sub-components.
- No `any`. No `useEffect` for derived state. No data fetching in `useEffect`.
