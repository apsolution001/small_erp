# 0013 — Shared Zod contracts between API and web

**Status:** Accepted · 2026-09-26

## Decision

`packages/contracts` holds a Zod schema for every request and response, the permission catalogue, enums and error codes. The API validates input with them. The web uses them for form validation and parses every response with them. An OpenAPI document is generated from the schemas (`z.toJSONSchema`) for the Tally connector and future public API.

## Consequences

- API and UI can never disagree on a field silently. A breaking change fails typecheck in both apps.
