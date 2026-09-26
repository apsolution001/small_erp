import { and, eq } from 'drizzle-orm';
import { type DbExecutor } from '../../infra/db/db-executor.js';
import { memberships } from './memberships/memberships.schema.js';
import { roles } from './roles/roles.schema.js';
import { buildSystemRoles } from './roles/roles.seed.js';

/**
 * Seeds the system roles of a new tenant and returns the Owner role. Runs in the caller's
 * transaction, which carries the tenant in `app.tenant_id`. Idempotent: it inserts only the
 * roles whose name is missing. (Role names are unique case-insensitively through an expression
 * index, which an `ON CONFLICT` target cannot name in Drizzle; a blanket `DO NOTHING` would also
 * swallow a violation of any other constraint.)
 */
export async function seedSystemRoles(
  db: DbExecutor,
  tenantId: string,
): Promise<{ ownerRoleId: string }> {
  const existing = await db
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.tenantId, tenantId));
  const taken = new Set(existing.map((role) => role.name.toLowerCase()));
  const missing = buildSystemRoles().filter((role) => !taken.has(role.name.toLowerCase()));
  if (missing.length > 0) await db.insert(roles).values(missing);

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

/**
 * Makes the signing-up user the tenant's Owner (all branches). Idempotent per (tenant, user), and
 * asserts the result: a membership that exists but is not an active Owner membership is an error,
 * never silently accepted as the owner's.
 */
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
    .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] });
  const [membership] = await db
    .select({
      id: memberships.id,
      status: memberships.status,
      roleId: memberships.roleId,
      allBranches: memberships.allBranches,
    })
    .from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.userId)));
  if (membership === undefined) {
    throw new Error(`No membership for user ${input.userId} in tenant ${input.tenantId}`);
  }
  if (
    membership.status !== 'active' ||
    membership.roleId !== input.ownerRoleId ||
    !membership.allBranches
  ) {
    throw new Error(
      `Membership ${membership.id} of user ${input.userId} in tenant ${input.tenantId} is not an active all-branches Owner membership`,
    );
  }
  return { membershipId: membership.id };
}
