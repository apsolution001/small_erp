import { and, eq } from 'drizzle-orm';
import { type DbExecutor } from '../../infra/db/db-executor.js';
import { memberships } from './memberships/memberships.schema.js';
import { roles } from './roles/roles.schema.js';
import { buildSystemRoles } from './roles/roles.seed.js';

/**
 * Seeds the system roles of a new tenant and returns the Owner role. Runs in the caller's
 * transaction, which carries the tenant in `app.tenant_id`. Idempotent (skips existing names).
 */
export async function seedSystemRoles(
  db: DbExecutor,
  tenantId: string,
): Promise<{ ownerRoleId: string }> {
  await db.insert(roles).values(buildSystemRoles()).onConflictDoNothing();
  const [owner] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.isOwner, true)));
  if (owner === undefined) throw new Error(`Tenant ${tenantId} has no Owner role after seeding`);
  return { ownerRoleId: owner.id };
}

export interface OwnerMembershipInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly ownerRoleId: string;
  readonly joinedAt: Date;
}

/** Makes the signing-up user the tenant's Owner (all branches). Idempotent per (tenant, user). */
export async function ensureOwnerMembership(
  db: DbExecutor,
  input: OwnerMembershipInput,
): Promise<{ membershipId: string }> {
  await db
    .insert(memberships)
    .values({
      userId: input.userId,
      roleId: input.ownerRoleId,
      allBranches: true,
      status: 'active',
      joinedAt: input.joinedAt,
    })
    .onConflictDoNothing();
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.userId)));
  if (membership === undefined) {
    throw new Error(`No membership for user ${input.userId} in tenant ${input.tenantId}`);
  }
  return { membershipId: membership.id };
}
