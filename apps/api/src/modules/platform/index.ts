/** Public surface of the platform module. */
export { lookupGstinOrUnavailable } from './gsp/gsp-lookup.js';
export { GSP_PROVIDER, type GspProvider } from './gsp/gsp-provider.js';
export { PlatformModule } from './platform.module.js';
export {
  TenantBootstrapService,
  type TenantBootstrapInput,
  type TenantBootstrapResult,
} from './tenants/tenant-bootstrap.service.js';
export { isUsableTenant, TenantsService, toTenantSummary } from './tenants/tenants.service.js';
export { type Tenant } from './tenants/tenants.schema.js';
