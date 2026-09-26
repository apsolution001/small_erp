# 0012 — External integrations behind ports

**Status:** Accepted · 2026-09-26

## Decision

Each external system is an interface (port) in the owning module, with adapters selected by config:

| Port                                                           | Adapters                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GspProvider` (GSTIN lookup, e-invoice IRN/cancel, e-way bill) | `mock` (dev/test, deterministic), `sandbox:<vendor>`, `<vendor>`. The vendor is still open (BRD §18) |
| `Mailer`                                                       | `smtp` (Mailpit in dev), provider adapter later                                                      |
| `ObjectStorage`                                                | S3-compatible (MinIO in dev, India-region bucket in prod)                                            |
| `TallyGateway`                                                 | Tally connector protocol (Windows agent polls the API over HTTPS)                                    |

BRD §16 asks for a second GSP option ready. The port makes switching a config change.
