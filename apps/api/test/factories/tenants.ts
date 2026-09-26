import { uuidv7 } from '@ekaro/core';
import {
  type NewTenant,
  type Tenant,
  tenants,
} from '../../src/modules/platform/tenants/tenants.schema.js';
import { testPlatformDb } from '../support/db.js';

const TRIAL_DAYS = 14;

/**
 * Inserts a tenant through the `ekaro_platform` role (as signup will) and returns it. Each call
 * gets a unique slug, so test files can run in parallel on one database.
 */
export async function createTestTenant(overrides: Partial<NewTenant> = {}): Promise<Tenant> {
  const [tenant] = await testPlatformDb()
    .insert(tenants)
    .values({
      slug: `test-${uuidv7()}`,
      status: 'trial',
      plan: 'growth',
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  if (tenant === undefined) throw new Error('tenant insert returned no row');
  return tenant;
}
