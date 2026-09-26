/**
 * Public surface of the masters module for other modules. The CRUD services arrive with
 * T-106/T-107; the tenant bootstrap and login use these executor-based functions (ADR 0015).
 */
export { type CompanySeed } from './company/company.seed.js';
export { findCompanyNames } from './company/company.queries.js';
export { type MastersSeedResult, seedTenantMasters } from './masters.seed.js';
