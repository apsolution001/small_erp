import { uuidv7 } from '@ekaro/core';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type Env } from '../../../config/env.js';
import { InjectEnv } from '../../../config/env.module.js';
import { Clock } from '../../../infra/clock/clock.js';
import { type DbExecutor, type DbTransaction } from '../../../infra/db/db-executor.js';
import { PLATFORM_DB, type PlatformDb } from '../../../infra/db/platform-db.js';
import {
  checkRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  newRefreshToken,
  refreshExpiry,
  sessionAbsoluteExpiry,
} from './refresh-token.js';
import { refreshTokens } from './refresh-tokens.schema.js';
import { type SessionRevokeReason, type SessionRow, sessions } from './sessions.schema.js';

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

/** Why a presented refresh token could not be used. */
export type TokenRefusal =
  | { readonly kind: 'unknown' | 'expired' }
  /** A revoked token, or a token of a revoked session: the family is now revoked. */
  | { readonly kind: 'reused'; readonly familyId: string };

export type Rotation =
  | {
      readonly kind: 'rotated';
      readonly userId: string;
      readonly membershipId: string;
      readonly issued: IssuedRefreshToken;
    }
  | TokenRefusal;

export type Switch =
  | { readonly kind: 'switched'; readonly issued: IssuedRefreshToken }
  | TokenRefusal
  /** The cookie belongs to another session than the access token. Nothing was revoked. */
  | { readonly kind: 'mismatch' };

interface StartInput {
  readonly userId: string;
  readonly membershipId: string;
  readonly meta: SessionMeta;
}

/** A presented token and its session, both locked, session first. */
type Locked =
  { readonly kind: 'found'; readonly session: SessionRow; readonly tokenId: string } | TokenRefusal;

/**
 * Login sessions (ADR 0006, ADR 0016): a `sessions` row per login, and its refresh-token family.
 * Opaque tokens stored as SHA-256 hashes, rotated on every use, the whole family revoked when a
 * revoked token comes back.
 *
 * Every operation that changes a family locks its `sessions` row first (`FOR UPDATE`), then the
 * token row. So rotation, logout, reuse detection and switch-tenant serialise per session, and a
 * revoked session can never gain a live token.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDb,
    @InjectEnv() private readonly env: Env,
    private readonly clock: Clock,
  ) {}

  /**
   * Starts a new session for a membership, ending `SESSION_ABSOLUTE_DAYS` from now. `db` may be
   * the caller's transaction (signup).
   */
  start(db: DbExecutor, input: StartInput): Promise<IssuedRefreshToken> {
    const now = this.clock.now();
    return this.startIn(db, input, sessionAbsoluteExpiry(now, this.env.SESSION_ABSOLUTE_DAYS));
  }

  /**
   * Exchanges a refresh token for the next one in its family. Two concurrent uses of one token
   * cannot both succeed: the second waits on the session lock, then sees the token revoked, which
   * is reuse and revokes the family.
   */
  async rotate(token: string, meta: SessionMeta): Promise<Rotation> {
    if (!isWellFormedRefreshToken(token)) return { kind: 'unknown' };
    return this.db.transaction(async (tx) => {
      const locked = await this.lock(tx, token);
      if (locked.kind !== 'found') return locked;
      const { session, tokenId } = locked;
      const next = await this.issue(tx, session, meta);
      await tx
        .update(refreshTokens)
        .set({ revokedAt: this.clock.now(), revokedReason: 'rotated', replacedById: next.id })
        .where(eq(refreshTokens.id, tokenId));
      return {
        kind: 'rotated',
        userId: session.userId,
        membershipId: session.membershipId,
        issued: next.token,
      };
    });
  }

  /**
   * Replaces the session of `token` by a new one for another membership of the same user, in one
   * transaction: the token must belong to `familyId` (the access token's session) and be live.
   * The new session keeps the old one's absolute end, so switching never extends a login.
   */
  async switchTo(
    token: string,
    familyId: string,
    target: { readonly membershipId: string; readonly meta: SessionMeta },
  ): Promise<Switch> {
    if (!isWellFormedRefreshToken(token)) return { kind: 'unknown' };
    return this.db.transaction(async (tx) => {
      const presented = await findToken(tx, token);
      if (presented === undefined) return { kind: 'unknown' };
      if (presented.familyId !== familyId) return { kind: 'mismatch' };
      const locked = await this.lock(tx, token);
      if (locked.kind !== 'found') return locked;
      const { session } = locked;
      await this.revokeLocked(tx, session.id, 'switched');
      const issued = await this.startIn(
        tx,
        { userId: session.userId, membershipId: target.membershipId, meta: target.meta },
        session.absoluteExpiresAt,
      );
      return { kind: 'switched', issued };
    });
  }

  /** Ends a whole session (logout, lost access). Idempotent. */
  async revokeFamily(familyId: string, reason: SessionRevokeReason): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockSession(tx, familyId);
      await this.revokeLocked(tx, familyId, reason);
    });
  }

  /**
   * Ends the session a refresh token belongs to; unknown tokens are ignored (logout). Returns the
   * session id when there was one.
   */
  async revokeByToken(token: string, reason: SessionRevokeReason): Promise<string | undefined> {
    if (!isWellFormedRefreshToken(token)) return undefined;
    const presented = await findToken(this.db, token);
    if (presented === undefined) return undefined;
    await this.revokeFamily(presented.familyId, reason);
    return presented.familyId;
  }

  /**
   * Locks the token's session, then the token, and checks both. A revoked token or session is
   * reuse: the family is revoked in the same transaction.
   */
  private async lock(tx: DbTransaction, token: string): Promise<Locked> {
    const presented = await findToken(tx, token);
    if (presented === undefined) return { kind: 'unknown' };
    const session = await lockSession(tx, presented.familyId);
    const [row] = await tx
      .select({ revokedAt: refreshTokens.revokedAt, expiresAt: refreshTokens.expiresAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.id, presented.id))
      .for('update');
    if (session === undefined || row === undefined) return { kind: 'unknown' };
    const check = checkRefreshToken(row, session, this.clock.now());
    if (check === 'reused') {
      await this.revokeLocked(tx, session.id, 'reuse_detected');
      return { kind: 'reused', familyId: session.id };
    }
    if (check === 'expired') return { kind: 'expired' };
    return { kind: 'found', session, tokenId: presented.id };
  }

  /** Revokes the session (if still live) and its live tokens. The caller holds the session lock. */
  private async revokeLocked(
    tx: DbTransaction,
    familyId: string,
    reason: SessionRevokeReason,
  ): Promise<void> {
    const now = this.clock.now();
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(sessions.id, familyId), isNull(sessions.revokedAt)));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  private async startIn(
    db: DbExecutor,
    input: StartInput,
    absoluteExpiresAt: Date,
  ): Promise<IssuedRefreshToken> {
    const [session] = await db
      .insert(sessions)
      .values({
        id: uuidv7(),
        userId: input.userId,
        membershipId: input.membershipId,
        createdAt: this.clock.now(),
        absoluteExpiresAt,
      })
      .returning();
    if (session === undefined) throw new Error('Session insert returned no row');
    const issued = await this.issue(db, session, input.meta);
    return issued.token;
  }

  private async issue(
    db: DbExecutor,
    session: SessionRow,
    meta: SessionMeta,
  ): Promise<{ id: string; token: IssuedRefreshToken }> {
    const refreshToken = newRefreshToken();
    const expiresAt = refreshExpiry(
      this.clock.now(),
      this.env.SESSION_IDLE_DAYS,
      session.absoluteExpiresAt,
    );
    const id = uuidv7();
    await db.insert(refreshTokens).values({
      id,
      familyId: session.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { id, token: { refreshToken, familyId: session.id, expiresAt } };
  }
}

/** The stored token for a raw token (no lock). */
async function findToken(
  db: DbExecutor,
  token: string,
): Promise<{ id: string; familyId: string } | undefined> {
  const [row] = await db
    .select({ id: refreshTokens.id, familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
  return row;
}

async function lockSession(tx: DbTransaction, id: string): Promise<SessionRow | undefined> {
  const [session] = await tx.select().from(sessions).where(eq(sessions.id, id)).for('update');
  return session;
}
