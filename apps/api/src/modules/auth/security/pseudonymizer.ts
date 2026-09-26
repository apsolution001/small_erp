import { createHmac, hkdfSync } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type Env } from '../../../config/env.js';
import { InjectEnv } from '../../../config/env.module.js';

/** HKDF label: this key is for pseudonyms only, never for encryption. */
const PSEUDONYM_INFO = 'ekaro:pseudonym:v1';

/** A stable, non-reversible stand-in for an identifier (hex, 128 bits). */
export type Pseudonym = string;

/**
 * Keyed pseudonyms (HMAC-SHA256) for identifiers that must not appear in logs or Redis keys:
 * emails and client IPs (security standard, DPDP Act). The same input always maps to the same
 * pseudonym, so events can be correlated, but without the key nobody can test a guessed email
 * against it. The key is derived from `DATA_ENCRYPTION_KEY` with HKDF under its own label.
 */
@Injectable()
export class Pseudonymizer {
  private readonly key: Buffer;

  constructor(@InjectEnv() env: Pick<Env, 'DATA_ENCRYPTION_KEY'>) {
    const master = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    this.key = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), PSEUDONYM_INFO, 32));
  }

  /** The pseudonym of an email, normalised as the contracts schema does (trimmed, lower case). */
  email(email: string): Pseudonym {
    return this.of(`email:${email.trim().toLowerCase()}`);
  }

  ip(ip: string): Pseudonym {
    return this.of(`ip:${ip}`);
  }

  private of(value: string): Pseudonym {
    return createHmac('sha256', this.key).update(value, 'utf8').digest('hex').slice(0, 32);
  }
}
