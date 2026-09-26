# Architecture Decision Records

The format is Context → Decision → Consequences. ADRs are immutable once `Accepted`. To change one, write a new ADR that supersedes it.

| #    | Title                                                                                                                     | Status   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Modular monolith in a pnpm/Turborepo monorepo](0001-modular-monolith-monorepo.md)                                        | Accepted |
| 0002 | [Technology stack](0002-technology-stack.md)                                                                              | Accepted |
| 0003 | [Multi-tenancy: shared schema + Postgres RLS](0003-multi-tenancy-rls.md)                                                  | Accepted |
| 0004 | [Drizzle ORM, SQL-first migrations, UUIDv7 keys](0004-drizzle-migrations-uuidv7.md)                                       | Accepted |
| 0005 | [Money as integer paise, quantities as decimals](0005-money-and-quantities.md)                                            | Accepted |
| 0006 | [Authentication: JWT access + rotating refresh tokens](0006-authentication.md)                                            | Accepted |
| 0007 | [Authorization: permission-based RBAC with branch scope](0007-authorization-rbac.md)                                      | Accepted |
| 0008 | [Audit log via database trigger](0008-audit-trigger.md)                                                                   | Accepted |
| 0009 | [Single posting engine, append-only ledgers](0009-posting-engine.md)                                                      | Accepted |
| 0010 | [Document lifecycle, approvals and numbering series](0010-document-lifecycle-numbering.md)                                | Accepted |
| 0011 | [Domain events, transactional outbox, BullMQ](0011-events-outbox-jobs.md)                                                 | Accepted |
| 0012 | [External integrations behind ports (GSP, email, storage, Tally)](0012-integration-ports.md)                              | Accepted |
| 0013 | [Shared Zod contracts between API and web](0013-shared-contracts.md)                                                      | Accepted |
| 0014 | [Tenant context plumbing: DB-side defaults, request transactions, audit storage](0014-tenant-context-plumbing.md)         | Accepted |
| 0015 | [Sessions, access resolution and platform access to module tables](0015-sessions-access-resolution.md)                    | Accepted |
| 0016 | [User directory for tenant code, granting authority, audit row keys and the outbox](0016-user-directory-grants-outbox.md) | Accepted |
