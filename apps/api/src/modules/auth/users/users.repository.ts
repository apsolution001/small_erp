import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type DbExecutor } from '../../../infra/db/db-executor.js';
import { PLATFORM_DB, type PlatformDb } from '../../../infra/db/platform-db.js';
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

  async recordSuccessfulLogin(id: string, now: Date): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, id));
  }
}
