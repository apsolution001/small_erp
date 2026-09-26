import { type ClsStore } from 'nestjs-cls';

/**
 * Per-request (or per-job) context kept in CLS (nestjs-cls, AsyncLocalStorage).
 * `requestId` is set for every request by the CLS middleware. The tenant fields are set by the
 * JWT guard (T-104) from the verified access token, never from request input, or by
 * `TenantContext.runInTenant()` for jobs.
 */
export interface RequestContext extends ClsStore {
  requestId: string;
  tenantId?: string;
  userId?: string;
  membershipId?: string;
}
