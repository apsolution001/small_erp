import {
  type Login,
  type MeResponse,
  type MembershipSummary,
  PERMISSIONS,
  type SelectTenant,
  type Signup,
  type TenantChoice,
  type TenantSelectionResponse,
  type TokenResponse,
  type UserSummary,
} from '@ekaro/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  LockedError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '../../common/errors/domain-error.js';
import { Clock } from '../../infra/clock/clock.js';
import { isUniqueViolation } from '../../infra/db/pg-errors.js';
import { PLATFORM_DB, type PlatformDb } from '../../infra/db/platform-db.js';
import { type Principal } from '../../infra/tenancy/request-context.js';
import { type AccessSnapshot, findActiveMembershipsOfUser } from '../access/index.js';
import { findCompanyNames } from '../masters/index.js';
import {
  GSP_PROVIDER,
  type GspProvider,
  isUsableTenant,
  type Tenant,
  TenantBootstrapService,
  TenantsService,
  toTenantSummary,
} from '../platform/index.js';
import { isCommonPassword } from './passwords/common-passwords.js';
import { PasswordHasher } from './passwords/password-hasher.js';
import { SessionAccessLoader } from './sessions/session-access.loader.js';
import { assertUsableSession } from './sessions/session-rules.js';
import {
  type IssuedRefreshToken,
  type SessionMeta,
  SessionService,
} from './sessions/session.service.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import { isLocked } from './users/lockout.js';
import { type UserRow } from './users/users.schema.js';
import { UsersRepository } from './users/users.repository.js';

/** A started or refreshed session: the response body, and the refresh token for the cookie. */
export interface SessionGrant {
  readonly body: TokenResponse;
  readonly refresh: IssuedRefreshToken;
}

export type LoginOutcome =
  | { readonly kind: 'session'; readonly grant: SessionGrant }
  | { readonly kind: 'selection'; readonly body: TenantSelectionResponse };

interface Choice extends TenantChoice {
  readonly membershipId: string;
}

const INVALID_CREDENTIALS = 'The email or password is incorrect.';
const LOCKED = 'Too many failed attempts. Try again in 15 minutes.';

/**
 * Signup, login, tenant selection, refresh, logout, switch-tenant and the current session
 * (spec 01 §3.1–3.2, ADR 0006). Works on the platform connection: nothing here is tenant data
 * read on behalf of a tenant user.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDb,
    @Inject(GSP_PROVIDER) private readonly gsp: GspProvider,
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly access: SessionAccessLoader,
    private readonly tenants: TenantsService,
    private readonly bootstrap: TenantBootstrapService,
    private readonly clock: Clock,
  ) {}

  /**
   * Creates the user, a trial tenant from the GSTIN registration and its seeded masters, and the
   * owner's session, in one platform transaction.
   */
  async signup(input: Signup, meta: SessionMeta): Promise<SessionGrant> {
    if (isCommonPassword(input.password)) {
      throw new ValidationError([
        { path: 'password', message: 'This password is too common', code: 'too_common' },
      ]);
    }
    if ((await this.users.findByEmail(input.email)) !== undefined) throw emailTaken();

    const registration = await this.lookupGstin(input.gstin);
    if (registration.status !== 'Active') {
      throw new BusinessRuleError(
        'GSTIN_INACTIVE',
        `This GSTIN is ${registration.status.toLowerCase()} on the GST portal.`,
      );
    }
    const passwordHash = await this.hasher.hash(input.password);
    const now = this.clock.now();

    const created = await this.db
      .transaction(async (tx) => {
        const user = await this.users.insert(tx, {
          email: input.email,
          mobile: input.mobile,
          fullName: input.fullName,
          passwordHash,
          lastLoginAt: now,
        });
        const tenant = await this.tenants.createTrial(
          tx,
          registration.tradeName ?? registration.legalName,
          now,
        );
        const { membershipId } = await this.bootstrap.bootstrap(tx, {
          tenantId: tenant.id,
          ownerUserId: user.id,
          registration,
          ownerEmail: user.email,
          ownerMobile: user.mobile,
          now,
        });
        const refresh = await this.sessions.start(tx, { userId: user.id, membershipId, meta });
        return { user, membershipId, refresh };
      })
      .catch((error: unknown) => {
        throw isUniqueViolation(error, 'users_email_unique') ? emailTaken(error) : error;
      });

    return this.grant(created.user, created.membershipId, created.refresh);
  }

  async login(input: Login, meta: SessionMeta): Promise<LoginOutcome> {
    const user = await this.users.findByEmail(input.email);
    const passwordHash = user?.passwordHash ?? null;
    if (passwordHash === null || user === undefined) {
      await this.hasher.verifyNothing(input.password);
      throw new UnauthorizedError('INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }
    const now = this.clock.now();
    if (isLocked(user, now)) throw new LockedError('ACCOUNT_LOCKED', LOCKED);

    if (!(await this.hasher.verify(input.password, passwordHash))) {
      const lockedUntil = await this.users.recordFailedLogin(user.id, now);
      if (isLocked({ lockedUntil }, now)) throw new LockedError('ACCOUNT_LOCKED', LOCKED);
      throw new UnauthorizedError('INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }
    if (user.status !== 'active') {
      throw new UnauthorizedError('ACCOUNT_DISABLED', 'This account has been disabled.');
    }
    await this.users.recordSuccessfulLogin(user.id, now);
    return this.enter(user, input.tenantId, meta);
  }

  /** The second step of a login with several companies. */
  async selectTenant(input: SelectTenant, meta: SessionMeta): Promise<SessionGrant> {
    const userId = await this.tokens.verifySelection(input.selectionToken);
    const user = await this.activeUser(userId);
    const outcome = await this.enter(user, input.tenantId, meta);
    if (outcome.kind !== 'session') throw new Error('A chosen tenant always yields a session');
    return outcome.grant;
  }

  /** Rotates the refresh token (reuse revokes the session) and issues a new access token. */
  async refresh(token: string, meta: SessionMeta): Promise<SessionGrant> {
    const rotation = await this.sessions.rotate(token, meta);
    switch (rotation.kind) {
      case 'unknown':
        throw new UnauthorizedError('TOKEN_INVALID', 'Your session is not valid. Sign in again.');
      case 'expired':
        throw new UnauthorizedError('TOKEN_EXPIRED', 'Your session has expired. Sign in again.');
      case 'reused':
        throw new UnauthorizedError(
          'REFRESH_REUSED',
          'This session was used from somewhere else and has been ended. Sign in again.',
        );
      case 'rotated':
        break;
    }
    const user = await this.users.findById(rotation.userId);
    try {
      if (user === undefined) throw new Error(`Session of unknown user ${rotation.userId}`);
      return await this.grant(user, rotation.membershipId, rotation.issued);
    } catch (error) {
      // The user, membership or tenant lost access since login: end the session for good.
      await this.sessions.revokeFamily(rotation.issued.familyId, 'access_revoked');
      throw error;
    }
  }

  /** Ends the session the refresh cookie belongs to. Idempotent, and silent for unknown tokens. */
  async logout(token: string | undefined): Promise<void> {
    if (token !== undefined) await this.sessions.revokeByToken(token, 'logout');
  }

  /** Moves the session to another of the user's companies: the old session ends. */
  async switchTenant(
    principal: Principal,
    tenantId: string,
    meta: SessionMeta,
  ): Promise<SessionGrant> {
    const user = await this.activeUser(principal.userId);
    const choice = await this.choiceFor(user.id, tenantId);
    const grant = await this.startSession(user, choice.membershipId, meta);
    await this.sessions.revokeFamily(principal.sessionId, 'switched');
    return grant;
  }

  async me(principal: Principal): Promise<MeResponse> {
    const user = await this.activeUser(principal.userId);
    const tenant = await this.tenants.findById(this.db, principal.tenantId);
    if (tenant === undefined) throw new Error(`Session of unknown tenant ${principal.tenantId}`);
    return {
      user: userSummary(user),
      tenant: await this.tenantSummary(tenant),
      membership: {
        id: principal.membershipId,
        role: { id: principal.roleId, name: principal.roleName },
        allBranches: principal.allBranches,
        branchIds: [...principal.branchIds],
        status: 'active',
      },
      permissions: PERMISSIONS.filter((p) => principal.permissions.has(p)),
    };
  }

  /** After a verified login: one company → session; several and none chosen → selection. */
  private async enter(
    user: UserRow,
    tenantId: string | undefined,
    meta: SessionMeta,
  ): Promise<LoginOutcome> {
    if (tenantId !== undefined) {
      const choice = await this.choiceFor(user.id, tenantId);
      return { kind: 'session', grant: await this.startSession(user, choice.membershipId, meta) };
    }
    const choices = await this.choicesOf(user.id);
    const [only, ...others] = choices;
    if (only === undefined) {
      throw new ForbiddenError('FORBIDDEN', 'Your account has no active company.');
    }
    if (others.length === 0) {
      return { kind: 'session', grant: await this.startSession(user, only.membershipId, meta) };
    }
    return {
      kind: 'selection',
      body: {
        requiresTenantSelection: true,
        selectionToken: await this.tokens.signSelection(user.id),
        tenants: choices.map(({ tenantId: id, name, slug, roleName }) => ({
          tenantId: id,
          name,
          slug,
          roleName,
        })),
      },
    };
  }

  private async startSession(
    user: UserRow,
    membershipId: string,
    meta: SessionMeta,
  ): Promise<SessionGrant> {
    const access = assertUsableSession(await this.access.fresh(membershipId), { userId: user.id });
    const refresh = await this.sessions.start(this.db, { userId: user.id, membershipId, meta });
    return this.grantFor(user, access, refresh);
  }

  /** Builds the token response for a session whose refresh token was just issued. */
  private async grant(
    user: UserRow,
    membershipId: string,
    refresh: IssuedRefreshToken,
  ): Promise<SessionGrant> {
    const access = assertUsableSession(await this.access.fresh(membershipId), { userId: user.id });
    return this.grantFor(user, access, refresh);
  }

  private async grantFor(
    user: UserRow,
    access: AccessSnapshot,
    refresh: IssuedRefreshToken,
  ): Promise<SessionGrant> {
    const tenant = await this.tenants.findById(this.db, access.tenantId);
    if (tenant === undefined) throw new Error(`Membership of unknown tenant ${access.tenantId}`);
    const accessToken = await this.tokens.signAccess({
      userId: user.id,
      tenantId: access.tenantId,
      membershipId: access.membershipId,
      sessionId: refresh.familyId,
    });
    return {
      body: {
        accessToken,
        user: userSummary(user),
        tenant: await this.tenantSummary(tenant),
        membership: membershipSummary(access),
      },
      refresh,
    };
  }

  /** The user's active memberships in usable (trial or active) tenants, oldest first. */
  private async choicesOf(userId: string): Promise<Choice[]> {
    const memberships = await findActiveMembershipsOfUser(this.db, userId);
    const tenantIds = memberships.map((m) => m.tenantId);
    const [tenants, names] = await Promise.all([
      this.tenants.findByIds(this.db, tenantIds),
      findCompanyNames(this.db, tenantIds),
    ]);
    const usable = new Map(tenants.filter(isUsableTenant).map((t) => [t.id, t]));
    return memberships.flatMap((m) => {
      const tenant = usable.get(m.tenantId);
      if (tenant === undefined) return [];
      return [
        {
          membershipId: m.membershipId,
          tenantId: tenant.id,
          name: names.get(tenant.id) ?? tenant.slug,
          slug: tenant.slug,
          roleName: m.roleName,
        },
      ];
    });
  }

  private async choiceFor(userId: string, tenantId: string): Promise<Choice> {
    const choice = (await this.choicesOf(userId)).find((c) => c.tenantId === tenantId);
    if (choice === undefined) {
      throw new ForbiddenError('FORBIDDEN', 'You do not have access to this company.');
    }
    return choice;
  }

  private async lookupGstin(gstin: string) {
    try {
      return await this.gsp.lookupGstin(gstin);
    } catch (error) {
      throw new ServiceUnavailableError(
        'SERVICE_UNAVAILABLE',
        'The GST portal could not be reached. Try again in a few minutes.',
        { cause: error },
      );
    }
  }

  private async activeUser(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (user?.status !== 'active') {
      throw new UnauthorizedError('ACCOUNT_DISABLED', 'This account has been disabled.');
    }
    return user;
  }

  private async tenantSummary(tenant: Tenant) {
    const names = await findCompanyNames(this.db, [tenant.id]);
    return toTenantSummary(tenant, names.get(tenant.id) ?? tenant.slug);
  }
}

function emailTaken(cause?: unknown): ConflictError {
  return new ConflictError(
    'EMAIL_TAKEN',
    'This email is already registered. Sign in instead.',
    cause === undefined ? undefined : { cause },
  );
}

function userSummary(user: UserRow): UserSummary {
  return { id: user.id, email: user.email, fullName: user.fullName, mobile: user.mobile };
}

function membershipSummary(access: AccessSnapshot): MembershipSummary {
  return {
    id: access.membershipId,
    role: { id: access.role.id, name: access.role.name },
    allBranches: access.allBranches,
    branchIds: access.branchIds,
    status: access.membershipStatus,
  };
}
