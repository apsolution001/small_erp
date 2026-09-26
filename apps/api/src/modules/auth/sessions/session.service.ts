import { uuidv7 } from '@ekaro/core';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type Env } from '../../../config/env.js';
import { InjectEnv } from '../../../config/env.module.js';
import { Clock } from '../../../infra/clock/clock.js';
import { type DbExecutor } from '../../../infra/db/db-executor.js';
import { PLATFORM_DB, type PlatformDb } from '../../../infra/db/platform-db.js';
import {
  checkRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  newRefreshToken,
  refreshExpiry,
} from './refresh-token.js';
import { type RefreshRevokeReason, refreshTokens } from './refresh-tokens.schema.js';

/** Where a session was started or refreshed from, kept for the user's session list. */
export interface SessionMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface IssuedRefreshToken {
  /** The raw token, for the cookie only. */
  readonly refreshToken: string;
  /** The session (token family); the access token's `sid`. */
  readonly familyId: string;
  readonly expiresAt: Date;
}

export type Rotation =
  | {
      readonly kind: 'rotated';
      readonly userId: string;
      readonly membershipId: string;
      readonly issued: IssuedRefreshToken;
    }
  | { readonly kind: 'unknown' | 'expired' | 'reused' };

/**
 * Login sessions as refresh-token families (ADR 0006): opaque tokens stored as SHA-256 hashes,
 * rotated on every use, the whole family revoked when a revoked token comes back.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDb,
    @InjectEnv() private readonly env: Env,
    private readonly clock: Clock,
  ) {}

  /** Starts a new session (family) for a membership. `db` may be the caller's transaction. */
  async start(
    db: DbExecutor,
    input: { userId: string; membershipId: string; meta: SessionMeta },
  ): Promise<IssuedRefreshToken> {
    const issued = await this.issue(db, { ...input, familyId: uuidv7() });
    return issued.token;
  }

  /**
   * Exchanges a refresh token for the next one in its family. Locks the presented row, so two
   * concurrent uses of one token cannot both succeed: the second sees it revoked and is treated
   * as reuse, which revokes the family.
   */
  async rotate(token: string, meta: SessionMeta): Promise<Rotation> {
    if (!isWellFormedRefreshToken(token)) return { kind: 'unknown' };
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)))
        .for('update');
      if (row === undefined) return { kind: 'unknown' };
      const check = checkRefreshToken(row, now);
      if (check === 'reused') {
        await revokeFamilyIn(tx, row.familyId, 'reuse_detected', now);
        return { kind: 'reused' };
      }
      if (check !== 'valid') return { kind: check };

      const next = await this.issue(tx, {
        userId: row.userId,
        membershipId: row.membershipId,
        familyId: row.familyId,
        meta,
      });
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now, revokedReason: 'rotated', replacedById: next.id })
        .where(eq(refreshTokens.id, row.id));
      return {
        kind: 'rotated',
        userId: row.userId,
        membershipId: row.membershipId,
        issued: next.token,
      };
    });
  }

  /** Ends a whole session (logout, switch-tenant, lost access). Idempotent. */
  async revokeFamily(familyId: string, reason: RefreshRevokeReason): Promise<void> {
    await revokeFamilyIn(this.db, familyId, reason, this.clock.now());
  }

  /** Ends the session a refresh token belongs to; unknown tokens are ignored (logout). */
  async revokeByToken(token: string, reason: RefreshRevokeReason): Promise<void> {
    if (!isWellFormedRefreshToken(token)) return;
    const [row] = await this.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
    if (row !== undefined) await this.revokeFamily(row.familyId, reason);
  }

  private async issue(
    db: DbExecutor,
    input: { userId: string; membershipId: string; familyId: string; meta: SessionMeta },
  ): Promise<{ id: string; token: IssuedRefreshToken }> {
    const refreshToken = newRefreshToken();
    const expiresAt = refreshExpiry(this.clock.now(), this.env.REFRESH_TOKEN_TTL_DAYS);
    const id = uuidv7();
    await db.insert(refreshTokens).values({
      id,
      userId: input.userId,
      membershipId: input.membershipId,
      familyId: input.familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });
    return { id, token: { refreshToken, familyId: input.familyId, expiresAt } };
  }
}

async function revokeFamilyIn(
  db: DbExecutor,
  familyId: string,
  reason: RefreshRevokeReason,
  now: Date,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}
