/**
 * Every Drizzle table, aggregated for the typed clients and for drizzle-kit (ADR 0004).
 * Modules add their `*.schema.ts` here.
 */
export * from '../../modules/platform/tenants/tenants.schema.js';
export * from '../../modules/auth/users/users.schema.js';
export * from '../../modules/auth/sessions/refresh-tokens.schema.js';
export * from '../../modules/access/roles/roles.schema.js';
export * from '../../modules/access/memberships/memberships.schema.js';
export * from '../../modules/masters/company/company-profile.schema.js';
export * from '../../modules/masters/branches/branches.schema.js';
export * from '../../modules/masters/godowns/godowns.schema.js';
export * from '../../modules/masters/units/units.schema.js';
export * from '../../modules/masters/tax-rates/tax-rates.schema.js';
export * from '../../modules/masters/document-series/document-series.schema.js';
