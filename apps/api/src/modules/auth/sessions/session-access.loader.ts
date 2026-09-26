import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PLATFORM_DB, type PlatformDb } from '../../../infra/db/platform-db.js';
import { AccessCache, type AccessSnapshot, loadMembershipAccess } from '../../access/index.js';
import { TenantsService } from '../../platform/index.js';
import { users } from '../users/users.schema.js';

/**
 * Builds the {@link AccessSnapshot} behind a session from the platform connection: the membership
 * with its role and branches (`platform_read`), the user's status and the tenant's status.
 */
@Injectable()
export class SessionAccessLoader {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDb,
    private readonly cache: AccessCache,
    private readonly tenants: TenantsService,
  ) {}

  /**
   * For every authenticated request: from the 60-second cache, else loaded and cached (unless the
   * tenant was invalidated during the load, see `AccessCache`).
   */
  cached(tenantId: string, membershipId: string): Promise<AccessSnapshot | undefined> {
    return this.cache.getOrLoad(tenantId, membershipId, () => this.load(membershipId));
  }

  /**
   * Fresh from the database (login, refresh, switch). Not written to the cache: without the
   * tenant known before the load, the generation check could not protect the write.
   */
  fresh(membershipId: string): Promise<AccessSnapshot | undefined> {
    return this.load(membershipId);
  }

  private async load(membershipId: string): Promise<AccessSnapshot | undefined> {
    const access = await loadMembershipAccess(this.db, membershipId);
    if (access === undefined) return undefined;
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, access.userId));
    const tenant = await this.tenants.findById(this.db, access.tenantId);
    if (user === undefined || tenant === undefined) return undefined;
    return {
      membershipId: access.membershipId,
      tenantId: access.tenantId,
      userId: access.userId,
      membershipStatus: access.status,
      userStatus: user.status,
      tenantStatus: tenant.status,
      role: access.role,
      permissions: [...access.permissions],
      allBranches: access.allBranches,
      branchIds: [...access.branchIds],
    };
  }
}
