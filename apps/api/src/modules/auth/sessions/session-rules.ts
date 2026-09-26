import { ForbiddenError, UnauthorizedError } from '../../../common/errors/domain-error.js';
import { type AccessSnapshot } from '../../access/index.js';

/**
 * The checks every session passes, on each request (cached access) and on login, refresh and
 * switch (fresh access): the membership exists and belongs to the token's user and tenant, and
 * the user, the tenant and the membership are all active. Returns the snapshot when usable.
 */
export function assertUsableSession(
  access: AccessSnapshot | undefined,
  expected: { readonly userId: string; readonly tenantId?: string },
): AccessSnapshot {
  if (
    access?.userId !== expected.userId ||
    (expected.tenantId !== undefined && access.tenantId !== expected.tenantId)
  ) {
    throw new UnauthorizedError('TOKEN_INVALID', 'Your session is not valid. Sign in again.');
  }
  if (access.userStatus !== 'active') {
    throw new UnauthorizedError('ACCOUNT_DISABLED', 'This account has been disabled.');
  }
  if (access.tenantStatus !== 'trial' && access.tenantStatus !== 'active') {
    throw new ForbiddenError('TENANT_SUSPENDED', 'This company account is not active.');
  }
  if (access.membershipStatus !== 'active') {
    throw new ForbiddenError('FORBIDDEN', 'Your access to this company has been disabled.');
  }
  return access;
}
