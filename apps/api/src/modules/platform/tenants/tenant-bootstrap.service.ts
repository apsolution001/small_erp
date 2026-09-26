import { currentFy } from '@ekaro/core';
import { type GstinLookupResponse } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { type DbTransaction } from '../../../infra/db/db-executor.js';
import { type RequestContext } from '../../../infra/tenancy/request-context.js';
import { ensureOwnerMembership, seedSystemRoles } from '../../access/index.js';
import { seedTenantMasters } from '../../masters/index.js';

export interface TenantBootstrapInput {
  readonly tenantId: string;
  /** The signing-up user: becomes the Owner and is recorded as the actor of every seeded row. */
  readonly ownerUserId: string;
  readonly registration: GstinLookupResponse;
  readonly ownerEmail: string;
  readonly ownerMobile: string | null;
  readonly now: Date;
}

export interface TenantBootstrapResult {
  readonly membershipId: string;
  readonly ownerRoleId: string;
  readonly headOfficeBranchId: string;
}

/**
 * Seeds a new tenant (spec 01 §3.1, spec 02 §4): masters, system roles and the Owner membership.
 * Runs inside the signup transaction on the platform connection. It first sets `app.tenant_id`
 * (and the actor and request id) for that transaction only, so every seed passes the tenant's
 * RLS `with check` and the audit rows name the owner. Idempotent: running it again for the same
 * tenant adds only what is missing.
 */
@Injectable()
export class TenantBootstrapService {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  async bootstrap(tx: DbTransaction, input: TenantBootstrapInput): Promise<TenantBootstrapResult> {
    const requestId = this.cls.isActive() ? this.cls.get('requestId') : '';
    await tx.execute(sql`select
      set_config('app.tenant_id', ${input.tenantId}, true),
      set_config('app.user_id', ${input.ownerUserId}, true),
      set_config('app.request_id', ${requestId}, true)`);

    const { registration } = input;
    const { headOfficeBranchId } = await seedTenantMasters(tx, input.tenantId, {
      legalName: registration.legalName,
      tradeName: registration.tradeName,
      gstin: registration.gstin,
      pan: registration.pan,
      address: registration.address,
      email: input.ownerEmail,
      phone: input.ownerMobile,
      fy: currentFy(input.now),
    });
    const { ownerRoleId } = await seedSystemRoles(tx, input.tenantId);
    const { membershipId } = await ensureOwnerMembership(tx, {
      tenantId: input.tenantId,
      userId: input.ownerUserId,
      ownerRoleId,
      joinedAt: input.now,
    });
    return { membershipId, ownerRoleId, headOfficeBranchId };
  }
}
