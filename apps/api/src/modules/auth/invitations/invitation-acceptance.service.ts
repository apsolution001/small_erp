import {
  type AcceptInvitation,
  type AcceptInvitationResponse,
  type InvitationPreview,
} from '@ekaro/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { hashOpaqueToken, isWellFormedOpaqueToken } from '../../../common/crypto/opaque-token.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../common/errors/domain-error.js';
import { Clock } from '../../../infra/clock/clock.js';
import { isUniqueViolation } from '../../../infra/db/pg-errors.js';
import { PLATFORM_DB, type PlatformDb } from '../../../infra/db/platform-db.js';
import { type RequestContext } from '../../../infra/tenancy/request-context.js';
import { applyTransactionContext } from '../../../infra/tenancy/transaction-context.js';
import {
  acceptInvitation,
  assertAcceptable,
  findInvitationByTokenHash,
  type InvitationForAcceptance,
} from '../../access/index.js';
import { findCompanyNames } from '../../masters/index.js';
import { isUsableTenant, TenantsService } from '../../platform/index.js';
import { isCommonPassword } from '../passwords/common-passwords.js';
import { PasswordHasher } from '../passwords/password-hasher.js';
import { UsersRepository } from '../users/users.repository.js';

/**
 * The public side of invitations (spec 01 §3.3): preview a link, and accept it. The token proves
 * control of the invited mailbox. A new email becomes a user with the name and password given;
 * an existing user just gains the membership and keeps their password. No session is started:
 * the user signs in next, so an invitation link alone never opens an existing account.
 */
@Injectable()
export class InvitationAcceptanceService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDb,
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly tenants: TenantsService,
    private readonly cls: ClsService<RequestContext>,
    private readonly clock: Clock,
  ) {}

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.usableInvitation(token);
    const [companyName, inviter, existing] = await Promise.all([
      this.companyName(invitation.tenantId),
      invitation.invitedBy === null ? undefined : this.users.findById(invitation.invitedBy),
      this.users.findByEmail(invitation.email),
    ]);
    return {
      email: invitation.email,
      companyName,
      roleName: invitation.roleName,
      invitedByName: inviter?.fullName ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
      existingUser: existing !== undefined,
    };
  }

  async accept(input: AcceptInvitation): Promise<AcceptInvitationResponse> {
    const invitation = await this.usableInvitation(input.token);
    const account = await this.accountFor(invitation, input);
    const now = this.clock.now();

    await this.db
      .transaction(async (tx) => {
        const userId =
          account.kind === 'existing'
            ? account.userId
            : (await this.users.insert(tx, { ...account.values, emailVerifiedAt: now })).id;
        // From here on, writes are the invitation's tenant's, made by the accepting user.
        await applyTransactionContext(tx, {
          tenantId: invitation.tenantId,
          userId,
          requestId: this.cls.isActive() ? this.cls.get('requestId') : undefined,
        });
        await acceptInvitation(tx, { invitationId: invitation.id, userId, now });
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'users_email_unique')) {
          throw new ConflictError('EMAIL_TAKEN', 'This email was just registered. Try again.', {
            cause: error,
          });
        }
        throw error;
      });

    return {
      email: invitation.email,
      tenant: { id: invitation.tenantId, name: await this.companyName(invitation.tenantId) },
      userCreated: account.kind === 'new',
    };
  }

  /**
   * An existing, active user accepts with the token alone (a password here would be a way to
   * overwrite theirs, so it is refused). A new email needs a name and an acceptable password.
   */
  private async accountFor(invitation: InvitationForAcceptance, input: AcceptInvitation) {
    const existing = await this.users.findByEmail(invitation.email);
    if (existing === undefined) {
      return { kind: 'new' as const, values: await this.newUserValues(invitation, input) };
    }
    if (existing.status !== 'active') {
      throw new UnauthorizedError('ACCOUNT_DISABLED', 'This account has been disabled.');
    }
    if (input.fullName !== undefined || input.password !== undefined) {
      throw new ValidationError([
        {
          path: 'password',
          message: 'This email already has an Ekaro account. Accept without a new password.',
          code: 'existing_user',
        },
      ]);
    }
    return { kind: 'existing' as const, userId: existing.id };
  }

  /** The invitation behind a token, if it can still be accepted into a usable company. */
  private async usableInvitation(token: string): Promise<InvitationForAcceptance> {
    const invitation = isWellFormedOpaqueToken(token)
      ? await findInvitationByTokenHash(this.db, hashOpaqueToken(token))
      : undefined;
    assertAcceptable(invitation, this.clock.now());
    const tenant = await this.tenants.findById(this.db, invitation.tenantId);
    if (tenant === undefined) {
      throw new NotFoundError('INVITATION_INVALID', 'This invitation link is not valid any more.');
    }
    if (!isUsableTenant(tenant)) {
      throw new ForbiddenError('TENANT_SUSPENDED', 'This company account is not active.');
    }
    return invitation;
  }

  /** A new user needs a name and an acceptable password (the same policy as signup). */
  private async newUserValues(invitation: InvitationForAcceptance, input: AcceptInvitation) {
    if (input.fullName === undefined || input.password === undefined) {
      throw new ValidationError([
        { path: 'fullName', message: 'Enter your name', code: 'required' },
        { path: 'password', message: 'Choose a password', code: 'required' },
      ]);
    }
    if (isCommonPassword(input.password)) {
      throw new ValidationError([
        { path: 'password', message: 'This password is too common', code: 'too_common' },
      ]);
    }
    return {
      email: invitation.email,
      fullName: input.fullName,
      passwordHash: await this.hasher.hash(input.password),
    };
  }

  private async companyName(tenantId: string): Promise<string> {
    const names = await findCompanyNames(this.db, [tenantId]);
    return names.get(tenantId) ?? '';
  }
}
