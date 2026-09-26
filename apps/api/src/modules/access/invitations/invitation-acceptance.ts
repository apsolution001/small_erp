import { and, eq, sql } from 'drizzle-orm';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../../common/errors/domain-error.js';
import { type DbExecutor, type DbTransaction } from '../../../infra/db/db-executor.js';
import { findActiveBranchIds } from '../../masters/index.js';
import { membershipBranches, memberships } from '../memberships/memberships.schema.js';
import { roles } from '../roles/roles.schema.js';
import { invitations } from './invitations.schema.js';

/**
 * Invitation acceptance, for the auth module on the platform connection (ADR 0015): accepting is
 * public, so the invitation is found by its token hash across tenants (`platform_read`), and the
 * membership is then written with that invitation's tenant in the transaction context.
 */

export interface InvitationForAcceptance {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly roleName: string;
  readonly invitedBy: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

export async function findInvitationByTokenHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<InvitationForAcceptance | undefined> {
  const [row] = await db
    .select({
      id: invitations.id,
      tenantId: invitations.tenantId,
      email: invitations.email,
      roleName: roles.name,
      invitedBy: invitations.createdBy,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    // Inner: an invitation whose role was deleted is closed, so it is as good as unknown.
    .innerJoin(
      roles,
      and(eq(roles.tenantId, invitations.tenantId), eq(roles.id, invitations.roleId)),
    )
    .where(eq(invitations.tokenHash, tokenHash));
  return row;
}

/**
 * Throws unless the invitation can still be accepted. Unknown, accepted and revoked links look
 * the same to the caller (404 `INVITATION_INVALID`); an expired one says so (422).
 */
export function assertAcceptable<
  T extends Pick<InvitationForAcceptance, 'expiresAt' | 'acceptedAt' | 'revokedAt'>,
>(invitation: T | undefined, now: Date): asserts invitation is T {
  if (invitation?.acceptedAt !== null || invitation.revokedAt !== null) {
    throw new NotFoundError(
      'INVITATION_INVALID',
      'This invitation link is not valid any more. Ask for a new invitation.',
    );
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw new BusinessRuleError(
      'INVITATION_EXPIRED',
      'This invitation has expired. Ask for a new invitation.',
    );
  }
}

/**
 * Turns the invitation into an active membership for `userId` and closes it. Runs in the caller's
 * transaction, which already carries the invitation's tenant (and the user as the actor). Locks
 * the invitation, so a link can be used once even when submitted twice at the same moment.
 */
export async function acceptInvitation(
  tx: DbTransaction,
  input: { readonly invitationId: string; readonly userId: string; readonly now: Date },
): Promise<{ membershipId: string }> {
  const [invitation] = await tx
    .select()
    .from(invitations)
    .where(eq(invitations.id, input.invitationId))
    .for('update');
  assertAcceptable(invitation, input.now);
  // invitations_role_while_pending guarantees an open invitation still names its role.
  if (invitation.roleId === null) throw new Error(`Open invitation ${invitation.id} has no role`);

  const [member] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.tenantId, invitation.tenantId), eq(memberships.userId, input.userId)),
    );
  if (member !== undefined) {
    throw new ConflictError('ALREADY_EXISTS', 'You are already a user of this company.');
  }
  const branchIds = invitation.allBranches ? [] : invitation.branchIds;
  const usable = await findActiveBranchIds(tx, branchIds);
  if (branchIds.some((b) => !usable.has(b))) {
    throw new BusinessRuleError(
      'INVITATION_INVALID',
      'A branch in this invitation is no longer active. Ask for a new invitation.',
    );
  }

  const [membership] = await tx
    .insert(memberships)
    .values({
      userId: input.userId,
      roleId: invitation.roleId,
      allBranches: invitation.allBranches,
      status: 'active',
      invitedBy: invitation.createdBy,
      joinedAt: input.now,
    })
    .returning({ id: memberships.id });
  if (membership === undefined) throw new Error('Membership insert returned no row');
  if (branchIds.length > 0) {
    await tx
      .insert(membershipBranches)
      .values(branchIds.map((branchId) => ({ membershipId: membership.id, branchId })));
  }
  await tx
    .update(invitations)
    .set({ acceptedAt: input.now, version: sql`${invitations.version} + 1` })
    .where(eq(invitations.id, invitation.id));
  return { membershipId: membership.id };
}
