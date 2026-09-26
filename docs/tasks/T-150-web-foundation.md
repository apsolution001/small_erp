---
id: T-150
title: 'Web foundation: app shell, UI kit, API client, auth screens, hotkeys'
status: todo
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
