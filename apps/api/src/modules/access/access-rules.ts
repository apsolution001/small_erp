import { type MembershipStatus, type Permission } from '@ekaro/contracts';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
} from '../../common/errors/domain-error.js';
import { type Principal } from '../../infra/tenancy/request-context.js';

/**
 * The access-management rules of spec 01 §3.3, as pure functions over plain facts. Services load
 * the facts (under the right locks) and call these before writing.
 */

/** Who is acting: from the request principal. */
export interface Actor {
  readonly membershipId: string;
  readonly isOwner: boolean;
  readonly permissions: ReadonlySet<Permission>;
}

export function actorOf(principal: Principal): Actor {
  return {
    membershipId: principal.membershipId,
    isOwner: principal.isOwner,
    permissions: principal.permissions,
  };
}

/** A role as far as granting goes: Owner or not, and its effective permissions. */
export interface RoleGrant {
  readonly isOwner: boolean;
  readonly permissions: readonly Permission[];
}

export interface MembershipState {
  readonly membershipId: string;
  readonly role: RoleGrant & { readonly id: string };
  readonly status: MembershipStatus;
}

/**
 * Nobody hands out more than they hold. Only an Owner may assign the Owner role or act on an
 * Owner's membership (spec 01 §3.3); anyone else may grant, edit or manage only roles whose
 * permissions they hold themselves, so `access.role:*` or `access.user:*` never becomes a path to
 * billing or other permissions the actor was not given.
 */
export function assertWithinAuthority(actor: Actor, role: RoleGrant): void {
  if (role.isOwner && !actor.isOwner) {
    throw new ForbiddenError(
      'OWNER_ASSIGNMENT_FORBIDDEN',
      'Only an Owner can assign or change the Owner role.',
    );
  }
  const missing = role.permissions.filter((p) => !actor.permissions.has(p));
  if (missing.length > 0) {
    throw new ForbiddenError(
      'PERMISSION_NOT_HELD',
      `You cannot grant permissions you do not hold: ${missing.join(', ')}.`,
    );
  }
}

/**
 * A membership's role or status change (`PATCH /users/:id`). `otherActiveOwners` counts the
 * tenant's other active Owner memberships, read under lock by the caller.
 */
export function assertMembershipChange(
  actor: Actor,
  current: MembershipState,
  next: Pick<MembershipState, 'role' | 'status'>,
  otherActiveOwners: number,
): void {
  const roleChanges = next.role.id !== current.role.id;
  if (current.membershipId === actor.membershipId) {
    if (roleChanges) {
      throw new BusinessRuleError('SELF_ROLE_CHANGE', 'You cannot change your own role.');
    }
    if (current.status === 'active' && next.status !== 'active') {
      throw new BusinessRuleError('SELF_DISABLE', 'You cannot disable your own access.');
    }
  }
  assertWithinAuthority(actor, current.role);
  if (roleChanges) assertWithinAuthority(actor, next.role);

  const wasActiveOwner = current.role.isOwner && current.status === 'active';
  const staysActiveOwner = next.role.isOwner && next.status === 'active';
  if (wasActiveOwner && !staysActiveOwner && otherActiveOwners === 0) {
    throw new BusinessRuleError(
      'LAST_OWNER',
      'The company must keep at least one active Owner. Make someone else an Owner first.',
    );
  }
}

/**
 * A role edit. The Owner role's permissions (the whole catalogue, computed) and its billing flag
 * never change; its name and description may (ADR 0015). Otherwise the actor must hold every
 * permission of the role before and after the edit.
 */
export function assertRoleEdit(
  actor: Actor,
  current: RoleGrant & { readonly isBillable: boolean },
  next: { readonly permissions: readonly Permission[]; readonly isBillable: boolean },
): void {
  assertWithinAuthority(actor, current);
  if (current.isOwner) {
    if (!samePermissions(current.permissions, next.permissions)) {
      throw new BusinessRuleError(
        'SYSTEM_ROLE_IMMUTABLE',
        'The Owner role always has every permission; its permissions cannot be edited.',
      );
    }
    if (next.isBillable !== current.isBillable) {
      throw new BusinessRuleError('SYSTEM_ROLE_IMMUTABLE', 'The Owner role is always billable.');
    }
    return;
  }
  assertWithinAuthority(actor, { isOwner: false, permissions: next.permissions });
}

/** System roles are templates and are never deleted; a role someone holds is never deleted. */
export function assertRoleDeletable(role: { readonly isSystem: boolean }, inUse: boolean): void {
  if (role.isSystem) {
    throw new BusinessRuleError(
      'SYSTEM_ROLE_IMMUTABLE',
      'System roles cannot be deleted. Clone one to make a variant.',
    );
  }
  if (inUse) throw roleInUse();
}

export function roleInUse(options?: ErrorOptions): ConflictError {
  return new ConflictError(
    'ROLE_IN_USE',
    'This role is assigned to users or pending invitations. Move them to another role first.',
    options,
  );
}

function samePermissions(a: readonly Permission[], b: readonly Permission[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((p) => right.has(p));
}
