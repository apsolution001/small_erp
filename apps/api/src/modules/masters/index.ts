/**
 * Public surface of the masters module for other modules: the Nest module with its exported
 * services, and the executor-based functions the tenant bootstrap and login use (ADR 0015).
 */
export { MastersModule } from './masters.module.js';
export { UnitsService } from './units/units.service.js';
export { findActiveBranchIds } from './branches/branches.queries.js';
export { type CompanySeed } from './company/company.seed.js';
export { findCompanyNames } from './company/company.queries.js';
export { type MastersSeedResult, seedTenantMasters } from './masters.seed.js';
