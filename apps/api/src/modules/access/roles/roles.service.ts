import {
  effectivePermissions,
  type PageMeta,
  type Permission,
  type RoleClone,
  type RoleCreate,
  type RoleListQuery,
  roleRecordSchema,
  type RoleResponse,
  type RoleUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  versionConflict,
} from '../../../common/errors/domain-error.js';
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../../infra/db/pg-errors.js';
import { currentPrincipal } from '../../../infra/tenancy/current-principal.js';
import { type RequestContext } from '../../../infra/tenancy/request-context.js';
import { TenantContext } from '../../../infra/tenancy/tenant-context.js';
import { AccessCache } from '../access-cache.js';
import {
  type Actor,
  actorOf,
  assertRoleDeletable,
  assertRoleEdit,
  assertWithinAuthority,
  roleInUse,
} from '../access-rules.js';
import { type RoleRow } from './roles.schema.js';
import { RolesRepository } from './roles.repository.js';

/**
 * Tenant roles (spec 01 §3.3, ADR 0007): list, read, create, edit, delete and clone. Every change
 * that can alter what a signed-in user may do drops the tenant's cached access after commit.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly cache: AccessCache,
    private readonly tenantContext: TenantContext,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async list(query: RoleListQuery): Promise<{ data: RoleResponse[]; meta: PageMeta }> {
    const { rows, total } = await this.roles.list(query);
    return {
      data: rows.map(toRoleResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(id: string): Promise<RoleResponse> {
    return toRoleResponse(found(await this.roles.findById(id)));
  }

  async create(input: RoleCreate): Promise<RoleResponse> {
    assertWithinAuthority(this.actor(), { isOwner: false, permissions: input.permissions });
    const row = await this.roles
      .insert({
        name: input.name,
        description: input.description,
        permissions: [...input.permissions],
        isBillable: input.isBillable,
      })
      .catch(rethrowNameTaken(input.name));
    return toRoleResponse(row);
  }

  /**
   * The authority and Owner-role rules first (who may make this change at all), then the merged
   * record (`roleRecordSchema`), so the Owner role reports its own rule rather than a derived one.
   */
  async update(id: string, patch: RoleUpdate): Promise<RoleResponse> {
    const existing = found(await this.roles.findById(id));
    if (existing.version !== patch.version) throw versionConflict();
    const { version, ...changes } = patch;
    const current = recordOf(existing);
    assertRoleEdit(this.actor(), grantOf(existing), {
      permissions: changes.permissions ?? current.permissions,
      isBillable: changes.isBillable ?? current.isBillable,
    });
    const parsed = roleRecordSchema.safeParse({ ...current, ...changes });
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    const next = parsed.data;

    const updated = await this.roles
      .update(id, version, {
        name: next.name,
        description: next.description,
        // The Owner role stores no permissions: they are computed (ADR 0015).
        permissions: existing.isOwner ? [] : next.permissions,
        isBillable: next.isBillable,
      })
      .catch(rethrowNameTaken(next.name));
    if (updated === undefined) throw versionConflict();
    this.invalidateTenantAfterCommit(existing.tenantId);
    return toRoleResponse(updated);
  }

  async delete(id: string): Promise<void> {
    const role = found(await this.roles.lockById(id));
    assertWithinAuthority(this.actor(), grantOf(role));
    assertRoleDeletable(role, await this.roles.isInUse(id));
    await this.roles.delete(id).catch((error: unknown) => {
      // Assigned concurrently: the membership FK, or a pending invitation's role check.
      if (
        isForeignKeyViolation(error, 'memberships_role_fk') ||
        isCheckViolation(error, 'invitations_role_while_pending')
      ) {
        throw roleInUse({ cause: error });
      }
      throw error;
    });
  }

  /** A new, editable (non-system) role with the source's effective permissions. */
  async clone(id: string, input: RoleClone): Promise<RoleResponse> {
    const source = found(await this.roles.findById(id));
    const permissions = effectivePermissions(source);
    assertWithinAuthority(this.actor(), { isOwner: false, permissions });
    const row = await this.roles
      .insert({
        name: input.name,
        description: source.description,
        permissions,
        isBillable: source.isBillable,
      })
      .catch(rethrowNameTaken(input.name));
    return toRoleResponse(row);
  }

  private actor(): Actor {
    return actorOf(currentPrincipal(this.cls));
  }

  /** A role's name or permissions changed: every membership holding it must reload its access. */
  private invalidateTenantAfterCommit(tenantId: string): void {
    this.tenantContext.afterCommit(() => this.cache.invalidateTenant(tenantId));
  }
}

export function toRoleResponse(row: RoleRow): RoleResponse {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    description: row.description,
    permissions: effectivePermissions(row),
    isSystem: row.isSystem,
    isOwner: row.isOwner,
    isBillable: row.isBillable,
  };
}

function recordOf(row: RoleRow) {
  return {
    name: row.name,
    description: row.description,
    permissions: effectivePermissions(row),
    isBillable: row.isBillable,
  };
}

function grantOf(row: RoleRow): {
  isOwner: boolean;
  permissions: Permission[];
  isBillable: boolean;
} {
  return {
    isOwner: row.isOwner,
    permissions: effectivePermissions(row),
    isBillable: row.isBillable,
  };
}

function found(row: RoleRow | undefined): RoleRow {
  if (row === undefined) throw new NotFoundError('NOT_FOUND', 'Role not found.');
  return row;
}

function rethrowNameTaken(name: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error, 'roles_tenant_name_unique')) {
      throw new ConflictError('ALREADY_EXISTS', `A role named "${name}" already exists.`, {
        cause: error,
      });
    }
    throw error;
  };
}
