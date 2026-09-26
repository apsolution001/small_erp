import { uuidv7 } from '@ekaro/core';
import { auditCursorSchema } from '@ekaro/contracts';
import { describe, expect, it } from 'vitest';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';

describe('audit cursor', () => {
  const cursor = { changedAt: '2026-09-26T06:30:00.123456Z', id: uuidv7() };

  it('round-trips the exact microsecond timestamp and id', () => {
    const encoded = encodeAuditCursor(cursor);
    expect(auditCursorSchema.safeParse(encoded).success).toBe(true);
    expect(decodeAuditCursor(encoded)).toEqual(cursor);
  });

  it('refuses anything it did not produce', () => {
    const enc = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
    for (const bad of [
      'bm90IGEgY3Vyc29y',
      enc(`2026-09-26T06:30:00.123Z|${cursor.id}`),
      enc(`2026-09-26T06:30:00.123456Z|not-a-uuid`),
      enc(`2026-09-26T06:30:00.123456Z|${cursor.id}|extra`),
      enc(`2026-13-45T06:30:00.123456Z|${cursor.id}`),
      enc('2026-09-26T06:30:00.123456Z'),
    ]) {
      expect(decodeAuditCursor(bad), bad).toBeUndefined();
    }
  });
});
