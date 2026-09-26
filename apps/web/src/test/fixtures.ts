import {
  type MeResponse,
  PERMISSIONS,
  type Permission,
  type Problem,
  type TokenResponse,
} from '@ekaro/contracts';

export const TENANT_ID = '01920000-0000-7000-8000-000000000001';
export const OTHER_TENANT_ID = '01920000-0000-7000-8000-000000000002';

/** A token response as the API sends it (signup, login, refresh, switch-tenant). */
export function tokenResponse(accessToken = 'access-1', tenantId = TENANT_ID): TokenResponse {
  return {
    accessToken,
    user: {
      id: '01920000-0000-7000-8000-0000000000a1',
      email: 'owner@example.com',
      fullName: 'Asha Mehta',
      mobile: '+919876543210',
    },
    tenant: {
      id: tenantId,
      slug: 'aapfu-traders',
      name: 'AAPFU0939F Traders',
      status: 'trial',
      plan: 'growth',
      trialEndsAt: '2026-10-10T06:00:00.000Z',
    },
    membership: {
      id: '01920000-0000-7000-8000-0000000000b1',
      role: { id: '01920000-0000-7000-8000-0000000000c1', name: 'Owner' },
      allBranches: true,
      branchIds: [],
      status: 'active',
    },
  };
}

export function meResponse(
  permissions: readonly Permission[] = PERMISSIONS,
  tenantId = TENANT_ID,
): MeResponse {
  const { user, tenant, membership } = tokenResponse('unused', tenantId);
  return { user, tenant, membership, permissions: [...permissions] };
}

export function problem(status: number, code: Problem['code'], extra: Partial<Problem> = {}) {
  return {
    type: `https://docs.ekaro.in/errors/${code.toLowerCase()}`,
    title: code,
    status,
    code,
    ...extra,
  } satisfies Problem;
}
