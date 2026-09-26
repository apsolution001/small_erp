import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type DbExecutor } from '../../../infra/db/db-executor.js';
import { PLATFORM_DB, type PlatformDb } from '../../../infra/db/platform-db.js';
import { lockoutEnd, MAX_FAILED_LOGINS } from './lockout.js';
import { type NewUserRow, type UserRow, users } from './users.schema.js';

/** The `users` platform table. */
@Injectable()
export class UsersRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDb) {}

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user;
  }

  /** `db` may be the caller's transaction (signup). */
  async insert(db: DbExecutor, values: NewUserRow): Promise<UserRow> {
    const [user] = await db.insert(users).values(values).returning();
    if (user === undefined) throw new Error('User insert returned no row');
    return user;
  }

  /**
   * Counts a failed login in one atomic statement (concurrent attempts cannot undercount). The
   * fifth consecutive failure locks the account and restarts the count. Returns the lock end.
   */
  async recordFailedLogin(id: string, now: Date): Promise<Date | null> {
    const reachesLimit = sql`${users.failedLoginCount} + 1 >= ${MAX_FAILED_LOGINS}`;
    const [row] = await this.db
      .update(users)
      .set({
        failedLoginCount: sql`case when ${reachesLimit} then 0 else ${users.failedLoginCount} + 1 end`,
        lockedUntil: sql`case when ${reachesLimit} then ${lockoutEnd(now).toISOString()}::timestamptz else ${users.lockedUntil} end`,
      })
      .where(eq(users.id, id))
      .returning({ lockedUntil: users.lockedUntil });
    return row?.lockedUntil ?? null;
  }

  async recordSuccessfulLogin(id: string, now: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(users.id, id));
  }
}
