import { uuidv7 } from '@ekaro/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessCache, type AccessSnapshot } from '../../src/modules/access/index.js';
import { createTestApp } from '../support/app.js';

function snapshotOf(tenantId: string, status: AccessSnapshot['membershipStatus']): AccessSnapshot {
  return {
    membershipId: MEMBERSHIP,
    tenantId,
    userId: USER,
    membershipStatus: status,
    userStatus: 'active',
    tenantStatus: 'active',
    role: { id: ROLE, name: 'Sales', isOwner: false },
    permissions: ['masters.item:view'],
    allBranches: true,
    branchIds: [],
  };
}

const MEMBERSHIP = uuidv7();
const USER = uuidv7();
const ROLE = uuidv7();

describe('AccessCache on Redis (ADR 0016)', () => {
  let app: NestExpressApplication;
  let cache: AccessCache;

  beforeAll(async () => {
    app = await createTestApp();
    cache = app.get(AccessCache);
  });

  afterAll(async () => {
    await app.close();
  });

  it('caches a load, and serves it until the membership is invalidated', async () => {
    const tenantId = uuidv7();
    const active = snapshotOf(tenantId, 'active');
    expect(await cache.getOrLoad(tenantId, MEMBERSHIP, () => Promise.resolve(active))).toEqual(
      active,
    );
    const unused = () => Promise.reject(new Error('should be served from cache'));
    expect(await cache.getOrLoad(tenantId, MEMBERSHIP, unused)).toEqual(active);

    await cache.invalidateMembership(tenantId, MEMBERSHIP);
    expect(await cache.get(tenantId, MEMBERSHIP)).toBeUndefined();
  });

  it('never caches a snapshot loaded before an invalidation that landed during the load', async () => {
    const tenantId = uuidv7();
    // The loader reads the membership (still active), then the change commits and its hook
    // runs, then the loader writes: the stale snapshot must not be cached.
    const loaded = await cache.getOrLoad(tenantId, MEMBERSHIP, async () => {
      const stale = snapshotOf(tenantId, 'active');
      await cache.invalidateMembership(tenantId, MEMBERSHIP);
      return stale;
    });
    expect(loaded?.membershipStatus).toBe('active');
    expect(await cache.get(tenantId, MEMBERSHIP)).toBeUndefined();

    // The next request loads the committed state and caches it.
    const disabled = snapshotOf(tenantId, 'disabled');
    await cache.getOrLoad(tenantId, MEMBERSHIP, () => Promise.resolve(disabled));
    expect(await cache.get(tenantId, MEMBERSHIP)).toEqual(disabled);
  });

  it('applies the same rule to a tenant-wide invalidation', async () => {
    const tenantId = uuidv7();
    const generation = await cache.generation(tenantId);
    if (generation === undefined) throw new Error('Redis is not reachable');
    await cache.invalidateTenant(tenantId);
    expect(await cache.set(snapshotOf(tenantId, 'active'), generation)).toBe(false);
    expect(await cache.get(tenantId, MEMBERSHIP)).toBeUndefined();

    const current = await cache.generation(tenantId);
    if (current === undefined) throw new Error('Redis is not reachable');
    expect(await cache.set(snapshotOf(tenantId, 'active'), current)).toBe(true);
    expect(await cache.get(tenantId, MEMBERSHIP)).toBeDefined();
  });
});
