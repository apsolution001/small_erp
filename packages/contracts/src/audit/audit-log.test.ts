import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import { auditLogEntrySchema, auditLogPageSchema, auditLogQuerySchema } from './audit-log.js';

describe('auditLogQuerySchema', () => {
  it('defaults the page size to 50 and coerces the limit', () => {
    expect(auditLogQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(auditLogQuerySchema.parse({ limit: '200' })).toEqual({ limit: 200 });
    expect(pathsOf(auditLogQuerySchema.safeParse({ limit: '201' }))).toEqual(['limit']);
    expect(pathsOf(auditLogQuerySchema.safeParse({ limit: '0' }))).toEqual(['limit']);
  });

  it('accepts every filter', () => {
    const query = {
      table: 'membership_branches',
      rowId: uuidv7(),
      userId: uuidv7(),
      action: 'UPDATE',
      from: '2026-09-01T00:00:00+05:30',
      to: '2026-09-30T00:00:00Z',
      cursor: 'MjAyNi0wOS0yNlQwMDowMDowMC4wMDAwMDBafDAxOTk',
      limit: 10,
    };
    expect(auditLogQuerySchema.parse(query)).toEqual(query);
  });

  it('refuses a table name that is not a plain identifier', () => {
    for (const table of ['Memberships', 'users;drop', '1abc', '']) {
      expect(pathsOf(auditLogQuerySchema.safeParse({ table })), table).toEqual(['table']);
    }
  });

  it('refuses a malformed cursor, bad ids and an unknown action', () => {
    expect(pathsOf(auditLogQuerySchema.safeParse({ cursor: 'a b' }))).toEqual(['cursor']);
    expect(pathsOf(auditLogQuerySchema.safeParse({ rowId: 'x' }))).toEqual(['rowId']);
    expect(pathsOf(auditLogQuerySchema.safeParse({ action: 'TRUNCATE' }))).toEqual(['action']);
  });

  it('needs from before to', () => {
    expect(
      pathsOf(
        auditLogQuerySchema.safeParse({ from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' }),
      ),
    ).toEqual(['to']);
    expect(
      pathsOf(
        auditLogQuerySchema.safeParse({ from: '2026-09-01T00:00:00Z', to: '2026-09-01T00:00:00Z' }),
      ),
    ).toEqual(['to']);
  });

  it('is strict: an unknown filter (or tenant) is refused', () => {
    expect(unrecognizedKeysOf(auditLogQuerySchema.safeParse({ tenantId: uuidv7() }))).toEqual([
      'tenantId',
    ]);
  });
});

describe('audit responses', () => {
  const entry = {
    id: uuidv7(),
    tableName: 'roles',
    rowId: uuidv7(),
    action: 'UPDATE',
    oldData: { name: 'Sales', version: 1 },
    newData: { name: 'Sales North', version: 2 },
    changedBy: { id: uuidv7(), name: 'Asha Mehta' },
    changedAt: '2026-09-26T06:30:00.123456Z',
    requestId: 'req-1',
  };

  it('parses an entry, with or without a known actor', () => {
    expect(auditLogEntrySchema.parse(entry)).toEqual(entry);
    const system = { ...entry, changedBy: null, rowId: null, requestId: null, oldData: null };
    expect(auditLogEntrySchema.parse(system)).toEqual(system);
    const unnamed = { ...entry, changedBy: { id: uuidv7(), name: null } };
    expect(auditLogEntrySchema.parse(unnamed)).toEqual(unnamed);
  });

  it('parses a page with its next cursor', () => {
    const page = { data: [entry], meta: { limit: 1, nextCursor: 'abc_-1' } };
    expect(auditLogPageSchema.parse(page)).toEqual(page);
    expect(auditLogPageSchema.parse({ data: [], meta: { limit: 50, nextCursor: null } })).toEqual({
      data: [],
      meta: { limit: 50, nextCursor: null },
    });
  });
});
