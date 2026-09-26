import { uuidv7 } from '@ekaro/core';
import { uuidSchema } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { z } from 'zod';
import { UnauthorizedError } from '../../../common/errors/domain-error.js';
import { type Env } from '../../../config/env.js';
import { InjectEnv } from '../../../config/env.module.js';
import { Clock } from '../../../infra/clock/clock.js';

/** What an access token proves (ADR 0006): who, in which tenant, as which membership, in which session. */
export interface AccessClaims {
  readonly userId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  /** The refresh-token family of the login session. */
  readonly sessionId: string;
}

/** A tenant-selection token lives just long enough to pick a company after login. */
export const SELECTION_TOKEN_TTL_SECONDS = 300;
const SELECTION_PURPOSE = 'tenant_selection';
const ALGORITHM = 'HS256';

/** Seconds since the epoch. The JWT library checks it; the schema makes it mandatory. */
const epochSeconds = z.number().int().positive();

const accessPayloadSchema = z.object({
  sub: uuidSchema,
  tid: uuidSchema,
  mid: uuidSchema,
  sid: uuidSchema,
  exp: epochSeconds,
});

const selectionPayloadSchema = z.object({
  sub: uuidSchema,
  jti: uuidSchema,
  purpose: z.literal(SELECTION_PURPOSE),
  exp: epochSeconds,
});

/** A verified tenant-selection token: its user, and its id and expiry for single use. */
export interface SelectionClaims {
  readonly userId: string;
  readonly tokenId: string;
  readonly expiresAt: Date;
}

/**
 * Signs and verifies the short-lived JWTs: access tokens (15 minutes, audience `JWT_AUDIENCE`)
 * and tenant-selection tokens (5 minutes, their own audience, so neither can stand in for the
 * other). HS256 only; issuer and audience are always checked. Time comes from {@link Clock}.
 */
@Injectable()
export class AccessTokenService {
  private readonly jwt: JwtService;
  private readonly selectionAudience: string;

  constructor(
    @InjectEnv() private readonly env: Env,
    private readonly clock: Clock,
  ) {
    this.jwt = new JwtService({ secret: env.JWT_ACCESS_SECRET });
    this.selectionAudience = `${env.JWT_AUDIENCE}:${SELECTION_PURPOSE}`;
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(
      {
        tid: claims.tenantId,
        mid: claims.membershipId,
        sid: claims.sessionId,
        iat: this.nowSeconds(),
      },
      {
        algorithm: ALGORITHM,
        subject: claims.userId,
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
        expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      },
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const payload = accessPayloadSchema.safeParse(await this.verify(token, this.env.JWT_AUDIENCE));
    if (!payload.success) throw invalidToken();
    const { sub, tid, mid, sid } = payload.data;
    return { userId: sub, tenantId: tid, membershipId: mid, sessionId: sid };
  }

  signSelection(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { purpose: SELECTION_PURPOSE, iat: this.nowSeconds() },
      {
        algorithm: ALGORITHM,
        subject: userId,
        jwtid: uuidv7(),
        issuer: this.env.JWT_ISSUER,
        audience: this.selectionAudience,
        expiresIn: SELECTION_TOKEN_TTL_SECONDS,
      },
    );
  }

  /** The user a selection token was issued to, and the token's id and expiry. */
  async verifySelection(token: string): Promise<SelectionClaims> {
    const payload = selectionPayloadSchema.safeParse(
      await this.verify(token, this.selectionAudience),
    );
    if (!payload.success) throw invalidToken();
    const { sub, jti, exp } = payload.data;
    return { userId: sub, tokenId: jti, expiresAt: new Date(exp * 1000) };
  }

  private async verify(token: string, audience: string): Promise<unknown> {
    try {
      return await this.jwt.verifyAsync<object>(token, {
        algorithms: [ALGORITHM],
        issuer: this.env.JWT_ISSUER,
        audience,
        clockTimestamp: this.nowSeconds(),
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedError('TOKEN_EXPIRED', 'Your session has expired.', { cause: error });
      }
      throw invalidToken(error);
    }
  }

  private nowSeconds(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }
}

function invalidToken(cause?: unknown): UnauthorizedError {
  return new UnauthorizedError(
    'TOKEN_INVALID',
    'Your session is not valid. Sign in again.',
    cause === undefined ? undefined : { cause },
  );
}
