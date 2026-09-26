import { Injectable, Logger } from '@nestjs/common';
import { Pseudonymizer } from './pseudonymizer.js';

/** The authentication events a security team alerts on (security standard, OWASP ASVS V7). */
export const SECURITY_EVENTS = [
  /** Wrong password, unknown email, or an account without a password. */
  'auth.login_failed',
  /** An account locked after repeated failures (`stage: started`), or a login refused by it. */
  'auth.lockout',
  /** A revoked refresh token came back: the session was revoked. */
  'auth.refresh_reused',
  /** A session ended because its user, membership or tenant lost access. */
  'auth.access_revoked',
  /** A disabled account tried to sign in or use a session. */
  'auth.disabled_account',
  /** switch-tenant was refused (no or foreign cookie, ended session, or a foreign tenant). */
  'auth.switch_denied',
] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

export interface SecurityEventFields {
  readonly userId?: string;
  readonly familyId?: string;
  /** Pseudonymised before logging. */
  readonly ip?: string | null;
  /** Pseudonymised before logging; for events without a known user (an unknown email). */
  readonly email?: string;
  /** A short machine-readable detail (`started`, `mismatch`, an error code...). */
  readonly reason?: string;
}

/**
 * Structured `warn` lines for security events: `{event, userId?, familyId?, ipHash?, emailHash?,
 * reason?}`. Emails and IPs appear only as keyed pseudonyms; passwords and tokens never.
 */
@Injectable()
export class SecurityEventLog {
  private readonly logger = new Logger('SecurityEvent');

  constructor(private readonly pseudonyms: Pseudonymizer) {}

  record(event: SecurityEvent, fields: SecurityEventFields = {}): void {
    const { userId, familyId, ip, email, reason } = fields;
    this.logger.warn(
      {
        event,
        ...(userId === undefined ? {} : { userId }),
        ...(familyId === undefined ? {} : { familyId }),
        ...(ip === undefined || ip === null ? {} : { ipHash: this.pseudonyms.ip(ip) }),
        ...(email === undefined ? {} : { emailHash: this.pseudonyms.email(email) }),
        ...(reason === undefined ? {} : { reason }),
      },
      event,
    );
  }
}
