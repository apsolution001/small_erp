import { describe, expect, it, vi } from 'vitest';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';
import { type AuditLogRepository, type AuditRow } from './audit-log.repository.js';
import { AuditLogService } from './audit-log.service.js';

const row = (n: number): AuditRow => ({
  id: `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  tableName: 'roles',
  rowId: '01920000-0000-7000-8000-00000000c001',
  action: 'UPDATE',
  oldData: { version: n },
  newData: { version: n + 1 },
  changedBy: n % 2 === 0 ? '01920000-0000-7000-8000-0000000000a1' : null,
  changedByName: n % 2 === 0 ? 'Asha' : null,
  changedAt: `2026-09-26T06:00:0${String(n)}.123456Z`,
  requestId: null,
});

function setup(rows: AuditRow[]) {
  const repo = { page: vi.fn(() => Promise.resolve(rows)) };
  return { service: new AuditLogService(repo as unknown as AuditLogRepository), repo };
}

describe('AuditLogService', () => {
  it('fetches one extra row to tell whether a next page exists, and cursors on the last shown row', async () => {
    const { service, repo } = setup([row(3), row(2), row(1)]);
    const page = await service.query({ limit: 2, table: 'roles' });
    expect(repo.page).toHaveBeenCalledWith({ limit: 2, table: 'roles', after: undefined }, 3);
    expect(page.data.map((e) => e.id)).toEqual([row(3).id, row(2).id]);
    expect(decodeAuditCursor(page.meta.nextCursor ?? '')).toEqual({
      changedAt: row(2).changedAt,
      id: row(2).id,
    });
    expect(page.data[1]?.changedBy).toEqual({ id: row(2).changedBy, name: 'Asha' });
    expect(page.data[0]?.changedBy).toBeNull();
  });

  it('ends with a null cursor on the last page', async () => {
    const { service } = setup([row(1)]);
    expect((await service.query({ limit: 2 })).meta).toEqual({ limit: 2, nextCursor: null });
  });

  it('passes a decoded cursor on, and refuses one it did not issue (422)', async () => {
    const { service, repo } = setup([]);
    const cursor = encodeAuditCursor({ changedAt: row(5).changedAt, id: row(5).id });
    await service.query({ limit: 50, cursor });
    expect(repo.page).toHaveBeenCalledWith(
      { limit: 50, cursor, after: { changedAt: row(5).changedAt, id: row(5).id } },
      51,
    );
    await expect(service.query({ limit: 50, cursor: 'Zm9v' })).rejects.toMatchObject({
      status: 422,
      errors: [{ path: 'cursor', message: 'Invalid cursor', code: 'invalid' }],
    });
  });
});
