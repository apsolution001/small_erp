---
paths:
  - 'apps/web/**'
---

# Web rules (full text: docs/standards/frontend.md)

- Server data only through TanStack Query hooks in `features/<area>/api.ts`. Every response is parsed with `@ekaro/contracts` schemas.
- Forms use react-hook-form + zodResolver with the contracts schema. Keyboard-first: Enter to the next field, Ctrl+S to save, Esc to cancel.
- Money goes through `MoneyInput` / `lib/format` (paise ↔ rupees, Indian grouping). Never do float math on money.
- shadcn/ui + Tailwind tokens only. Show every loading, empty and error state. Must work at 1366×768.
- `useCan()` gates UI actions. The API still enforces them.
