import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';

/** bcrypt work factor (BRD §10, ADR 0006). */
export const BCRYPT_COST = 12;

@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_COST);
  }

  verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Spends the same time as a real check, for an email with no account (or no password), so
   * response times do not reveal which emails are registered. Always false.
   */
  async verifyNothing(password: string): Promise<false> {
    this.dummyHash ??= bcrypt.hash('ekaro-no-such-account', BCRYPT_COST);
    await bcrypt.compare(password, await this.dummyHash);
    return false;
  }
}
