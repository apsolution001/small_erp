import {
  effectivePermissions,
  type InvitationListQuery,
  type InvitationResponse,
  type PageMeta,
  type UserInvite,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { hashOpaqueToken, newOpaqueToken } from '../../../common/crypto/opaque-token.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain-error.js';
import { type Env } from '../../../config/env.js';
import { InjectEnv } from '../../../config/env.module.js';
import { Clock } from '../../../infra/clock/clock.js';
import { isUniqueViolation } from '../../../infra/db/pg-errors.js';
import { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { currentPrincipal } from '../../../infra/tenancy/current-principal.js';
import { type RequestContext } from '../../../infra/tenancy/request-context.js';
import { actorOf, assertWithinAuthority } from '../access-rules.js';
import { RolesRepository } from '../roles/roles.repository.js';
import { UsersRepository } from '../users/users.repository.js';
import { type InvitationListRow, InvitationsRepository } from './invitations.repository.js';

/** Spec 01 §1: an invitation link is valid for 7 days. */
export const INVITATION_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Invitations (spec 01 §3.3): `POST /users` invites, `GET /invitations` lists, `DELETE` revokes.
 * The email is recorded in the outbox in the same transaction (ADR 0011), so it goes out if and
 * only if the invitation is saved. Accepting is public and lives in the auth module.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly roles: RolesRepository,
    private readonly users: UsersRepository,
    private readonly outbox: OutboxWriter,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
    @InjectEnv() private readonly env: Env,
  ) {}

  async list(query: InvitationListQuery): Promise<{ data: InvitationResponse[]; meta: PageMeta }> {
    const { rows, total } = await this.invitations.list(query);
    return {
      data: rows.map(toInvitationResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /**
   * Invites an email with a role and branch scope. Inviting an email that already has an open
   * invitation replaces it (the old link stops working): that is how an invitation is re-sent.
   */
  async invite(input: UserInvite): Promise<InvitationResponse> {
    const principal = currentPrincipal(this.cls);
    const role = await this.roles.findById(input.roleId);
    if (role === undefined) {
      throw new ValidationError([{ path: 'roleId', message: 'Unknown role', code: 'not_found' }]);
    }
    assertWithinAuthority(actorOf(principal), {
      isOwner: role.isOwner,
      permissions: effectivePermissions(role),
    });
    const usable = await this.users.activeBranchIds(input.branchIds);
    if (input.branchIds.some((b) => !usable.has(b))) {
      throw new ValidationError([
        { path: 'branchIds', message: 'Unknown or inactive branch', code: 'not_found' },
      ]);
    }
    if ((await this.users.findIdByEmail(input.email)) !== undefined) {
      throw new ConflictError(
        'ALREADY_EXISTS',
        `${input.email} is already a user of this company.`,
      );
    }

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS);
    const token = newOpaqueToken();
    await this.invitations.revokeOpenByEmail(input.email, now);
    const { id } = await this.invitations
      .insert({
        email: input.email,
        roleId: role.id,
        allBranches: input.allBranches,
        branchIds: [...input.branchIds],
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'invitations_one_pending_per_email')) {
          throw new ConflictError(
            'ALREADY_EXISTS',
            `An invitation to ${input.email} is being sent right now. Try again in a moment.`,
            { cause: error },
          );
        }
        throw error;
      });

    await this.outbox.enqueue('email.user_invitation', {
      to: input.email,
      invitationId: id,
      companyName: (await this.invitations.companyName(principal.tenantId)) ?? 'your company',
      roleName: role.name,
      invitedByName: (await this.users.findUserName(principal.userId)) ?? null,
      acceptUrl: this.acceptUrl(token),
      expiresAt: expiresAt.toISOString(),
    });
    return toInvitationResponse(found(await this.invitations.findById(id)));
  }

  /** Revokes an open (pending or expired) invitation: its link stops working, its role is freed. */
  async revoke(id: string): Promise<void> {
    found(await this.invitations.findById(id));
    if (!(await this.invitations.revoke(id, this.clock.now()))) {
      throw new ConflictError(
        'INVALID_TRANSITION',
        'This invitation was already accepted or revoked.',
      );
    }
  }

  /**
   * The link in the email. The token travels in the fragment, which browsers never send to a
   * server, so it stays out of access logs, proxies and Referer headers; the page posts it.
   */
  private acceptUrl(token: string): string {
    const url = new URL('/accept-invitation', this.env.APP_ORIGIN);
    url.hash = `token=${token}`;
    return url.toString();
  }
}

export function toInvitationResponse(row: InvitationListRow): InvitationResponse {
  return {
    id: row.id,
    email: row.email,
    role:
      row.roleId === null || row.roleName === null ? null : { id: row.roleId, name: row.roleName },
    allBranches: row.allBranches,
    branchIds: row.branchIds,
    status: row.status,
    invitedBy:
      row.invitedById === null || row.invitedByName === null
        ? null
        : { id: row.invitedById, name: row.invitedByName },
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function found(row: InvitationListRow | undefined): InvitationListRow {
  if (row === undefined) throw new NotFoundError('NOT_FOUND', 'Invitation not found.');
  return row;
}
