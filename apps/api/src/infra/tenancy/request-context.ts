import { type Permission } from '@ekaro/contracts';
import { type ClsStore } from 'nestjs-cls';

/**
 * The authenticated caller, set by `JwtAuthGuard` from a verified access token and the
 * membership it names. `PermissionGuard` checks routes against it; services use the branch scope.
 */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  /** The login session (refresh-token family), the access token's `sid`. */
  readonly sessionId: string;
  readonly roleId: string;
  readonly roleName: string;
  /** Effective permissions (the whole catalogue for the Owner). */
  readonly permissions: ReadonlySet<Permission>;
  readonly allBranches: boolean;
  /** Empty when `allBranches`. */
  readonly branchIds: readonly string[];
}

/**
 * Per-request (or per-job) context kept in CLS (nestjs-cls, AsyncLocalStorage).
 * `requestId` is set for every request by the CLS middleware. The tenant fields are set by the
 * JWT guard from the verified access token, never from request input, or by
 * `TenantContext.runInTenant()` for jobs.
 */
export interface RequestContext extends ClsStore {
  requestId: string;
  tenantId?: string;
  userId?: string;
  membershipId?: string;
  principal?: Principal;
}
