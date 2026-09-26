import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pseudonymizer } from './pseudonymizer.js';
import { SecurityEventLog } from './security-events.js';

const env = { DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const otherEnv = { DATA_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Pseudonymizer', () => {
  it('maps an email to a stable keyed pseudonym, whatever its case and spacing', () => {
    const p = new Pseudonymizer(env);
    const pseudonym = p.email('Asha@Example.com ');
    expect(pseudonym).toMatch(/^[0-9a-f]{32}$/);
    expect(p.email('asha@example.com')).toBe(pseudonym);
    expect(p.email('ravi@example.com')).not.toBe(pseudonym);
    expect(new Pseudonymizer(otherEnv).email('asha@example.com')).not.toBe(pseudonym);
  });

  it('keeps emails and IPs in separate domains', () => {
    const p = new Pseudonymizer(env);
    expect(p.ip('10.0.0.1')).toMatch(/^[0-9a-f]{32}$/);
    expect(p.ip('x')).not.toBe(p.email('x'));
  });
});

describe('SecurityEventLog', () => {
  it('logs a structured warn with pseudonyms, never the email or the IP', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const p = new Pseudonymizer(env);
    new SecurityEventLog(p).record('auth.login_failed', {
      email: 'asha@example.com',
      ip: '203.0.113.9',
      reason: 'INVALID_CREDENTIALS',
    });
    new SecurityEventLog(p).record('auth.refresh_reused', { userId: 'u-1', familyId: 'f-1' });

    expect(warn).toHaveBeenNthCalledWith(
      1,
      {
        event: 'auth.login_failed',
        emailHash: p.email('asha@example.com'),
        ipHash: p.ip('203.0.113.9'),
        reason: 'INVALID_CREDENTIALS',
      },
      'auth.login_failed',
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      { event: 'auth.refresh_reused', userId: 'u-1', familyId: 'f-1' },
      'auth.refresh_reused',
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('asha@example.com');
    expect(logged).not.toContain('203.0.113.9');
  });
});
