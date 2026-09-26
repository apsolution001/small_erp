import {
  effectivePermissions,
  type PageMeta,
  type UserListQuery,
  userRecordSchema,
  type UserResponse,
  type UserUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  NotFoundError,
  ValidationError,
  versionConflict,
} from '../../../common/errors/domain-error.js';
import { Clock } from '../../../infra/clock/clock.js';
import { currentPrincipal } from '../../../infra/tenancy/current-principal.js';
import { type RequestContext } from '../../../infra/tenancy/request-context.js';
import { TenantContext } from '../../../infra/tenancy/tenant-context.js';
import { AccessCache } from '../access-cache.js';
import {
  type Actor,
  actorOf,
  assertMembershipChange,
  type MembershipState,
} from '../access-rules.js';
import { RolesRepository } from '../roles/roles.repository.js';
import { type MemberRow, UsersRepository } from './users.repository.js';

/**
 * Tenant users = memberships (spec 01 §3.3): the list and the role, branch-scope and status
 * changes, with the safety rules of `access-rules.ts`. Each change drops the membership's cached
 * access after commit, so it applies from the next request.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly cache: AccessCache,
    private readonly tenantContext: TenantContext,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
  ) {}

  async list(query: UserListQuery): Promise<{ data: UserResponse[]; meta: PageMeta }> {
    const { rows, total } = await this.users.list(query);
    return {
      data: rows.map(toUserResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(id: string): Promise<UserResponse> {
    return toUserResponse(found(await this.users.findById(id)));
  }

  /** `PATCH /users/:membershipId`: validates the merged record, then the §3.3 safety rules. */
  async update(id: string, patch: UserUpdate): Promise<UserResponse> {
    const existing = found(await this.users.findById(id));
    if (existing.version !== patch.version) throw versionConflict();
    const { version, ...changes } = patch;
    const parsed = userRecordSchema.safeParse({
      roleId: existing.roleId,
      allBranches: existing.allBranches,
      branchIds: existing.branchIds,
      status: existing.status,
      ...changes,
    });
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    const next = parsed.data;

    const current = stateOf(existing);
    const nextRole = await this.roleFor(next.roleId, current);
    await this.assertBranchesUsable(next.branchIds, existing.branchIds);
    const otherOwners =
      current.role.isOwner && current.status === 'active'
        ? await this.users.countOtherActiveOwners(current.role.id, existing.id)
        : 0;
    assertMembershipChange(
      this.actor(),
      current,
      { role: nextRole, status: next.status },
      otherOwners,
    );

    const updated = await this.users.update(id, version, {
      roleId: next.roleId,
      allBranches: next.allBranches,
      status: next.status,
      joinedAt: existing.joinedAt ?? (next.status === 'active' ? this.clock.now() : null),
    });
    if (updated === undefined) throw versionConflict();
    if (!sameIds(next.branchIds, existing.branchIds)) {
      await this.users.replaceBranches(id, next.branchIds);
    }
    this.tenantContext.afterCommit(() => this.cache.invalidateMembership(existing.tenantId, id));
    return this.get(id);
  }

  private async roleFor(
    roleId: string,
    current: MembershipState,
  ): Promise<MembershipState['role']> {
    if (roleId === current.role.id) return current.role;
    const role = await this.roles.findById(roleId);
    if (role === undefined) {
      throw new ValidationError([{ path: 'roleId', message: 'Unknown role', code: 'not_found' }]);
    }
    return { id: role.id, isOwner: role.isOwner, permissions: effectivePermissions(role) };
  }

  /** Newly added branches must be active branches of this company. */
  private async assertBranchesUsable(
    branchIds: readonly string[],
    current: readonly string[],
  ): Promise<void> {
    const added = branchIds.filter((b) => !current.includes(b));
    const usable = await this.users.activeBranchIds(added);
    if (added.some((b) => !usable.has(b))) {
      throw new ValidationError([
        { path: 'branchIds', message: 'Unknown or inactive branch', code: 'not_found' },
      ]);
    }
  }

  private actor(): Actor {
    return actorOf(currentPrincipal(this.cls));
  }
}

export function toUserResponse(row: MemberRow): UserResponse {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
    email: row.email,
    fullName: row.fullName,
    mobile: row.mobile,
    role: { id: row.roleId, name: row.roleName },
    allBranches: row.allBranches,
    branchIds: row.branchIds,
    status: row.status,
    joinedAt: row.joinedAt?.toISOString() ?? null,
  };
}

function stateOf(row: MemberRow): MembershipState {
  return {
    membershipId: row.id,
    role: {
      id: row.roleId,
      isOwner: row.roleIsOwner,
      permissions: effectivePermissions({
        isOwner: row.roleIsOwner,
        permissions: row.rolePermissions,
      }),
    },
    status: row.status,
  };
}

function found(row: MemberRow | undefined): MemberRow {
  if (row === undefined) throw new NotFoundError('NOT_FOUND', 'User not found.');
  return row;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
