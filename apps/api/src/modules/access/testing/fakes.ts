import { PERMISSIONS, type Permission } from '@ekaro/contracts';
import { type ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { type Principal, type RequestContext } from '../../../infra/tenancy/request-context.js';
import { type TenantContext } from '../../../infra/tenancy/tenant-context.js';
import { type AccessCache } from '../access-cache.js';

/** Unit-test doubles for the access services: principal, after-commit queue, access cache. */

export const TENANT_ID = '01920000-0000-7000-8000-000000000001';

export function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: '01920000-0000-7000-8000-0000000000a1',
    tenantId: TENANT_ID,
    membershipId: '01920000-0000-7000-8000-0000000000b1',
    sessionId: 's',
    roleId: 'r-owner',
    roleName: 'Owner',
    isOwner: true,
    permissions: new Set<Permission>(PERMISSIONS),
    allBranches: true,
    branchIds: [],
    ...overrides,
  };
}

export function fakeCls(who: Principal): ClsService<RequestContext> {
  return {
    isActive: () => true,
    get: (key: string) => (key === 'principal' ? who : undefined),
  } as unknown as ClsService<RequestContext>;
}

/** Collects `afterCommit` callbacks; `commit()` runs them as the real context would. */
export function fakeTenantContext() {
  const queued: (() => Promise<void>)[] = [];
  const context = {
    afterCommit: (callback: () => Promise<void>) => {
      queued.push(callback);
    },
  } as unknown as TenantContext;
  return {
    context,
    queued,
    commit: async () => {
      for (const callback of queued.splice(0)) await callback();
    },
  };
}

export function fakeAccessCache() {
  const cache = {
    invalidateMembership: vi.fn(() => Promise.resolve()),
    invalidateTenant: vi.fn(() => Promise.resolve()),
  };
  return { cache, accessCache: cache as unknown as AccessCache };
}
