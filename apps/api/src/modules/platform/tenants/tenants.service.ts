import { type TenantSummary } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { type DbExecutor } from '../../../infra/db/db-executor.js';
import { slugify, withRandomSuffix } from './tenant-slug.js';
import { type Tenant, tenants } from './tenants.schema.js';

/** Free trial with growth-plan features (BRD §12, spec 01 §1). */
export const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const SLUG_ATTEMPTS = 5;

/**
 * The `tenants` platform table. Methods take the executor so they can join the caller's
 * transaction (signup creates the user, tenant and seeds atomically).
 */
@Injectable()
export class TenantsService {
  /** A new tenant on a 14-day trial, with a unique slug derived from the company name. */
  async createTrial(db: DbExecutor, companyName: string, now: Date): Promise<Tenant> {
    const base = slugify(companyName);
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      const [tenant] = await db
        .insert(tenants)
        .values({
          slug: attempt === 0 ? base : withRandomSuffix(base),
          status: 'trial',
          plan: 'growth',
          trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
        })
        .onConflictDoNothing({ target: tenants.slug })
        .returning();
      if (tenant !== undefined) return tenant;
    }
    throw new Error(`Could not find a free tenant slug for "${base}"`);
  }

  async findById(db: DbExecutor, tenantId: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    return tenant;
  }

  async findByIds(db: DbExecutor, tenantIds: readonly string[]): Promise<Tenant[]> {
    if (tenantIds.length === 0) return [];
    return db
      .select()
      .from(tenants)
      .where(inArray(tenants.id, [...tenantIds]));
  }
}

/** Only trial and active tenants can be used; suspended and closed ones cannot be entered. */
export function isUsableTenant(tenant: Pick<Tenant, 'status'>): boolean {
  return tenant.status === 'trial' || tenant.status === 'active';
}

export function toTenantSummary(tenant: Tenant, companyName: string): TenantSummary {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: companyName,
    status: tenant.status,
    plan: tenant.plan,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
  };
}
