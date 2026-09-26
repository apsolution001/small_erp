import { describe, expect, it } from 'vitest';
import { rateLimitSubject } from './client-ip.js';

describe('rateLimitSubject', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(rateLimitSubject('203.0.113.9')).toBe('203.0.113.9');
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(rateLimitSubject('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(rateLimitSubject('::FFFF:203.0.113.9')).toBe('203.0.113.9');
  });

  it('buckets IPv6 by its /64: one subscriber cannot rotate through its own prefix', () => {
    expect(rateLimitSubject('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(rateLimitSubject('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateLimitSubject('2001:DB8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(rateLimitSubject('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitSubject('2001:0db8:0001:0003::1')).toBe('2001:db8:1:3::/64');
    expect(rateLimitSubject('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitSubject('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitSubject('64:ff9b::203.0.113.9')).toBe('64:ff9b:0:0::/64');
  });

  it('falls back to a single bucket for anything that is not an IP address', () => {
    expect(rateLimitSubject(undefined)).toBe('unknown');
    expect(rateLimitSubject('not an ip')).toBe('unknown');
  });
});
