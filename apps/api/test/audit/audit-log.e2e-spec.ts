import { type AuditLogPage, auditLogPageSchema, problemSchema } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headOfficeId, type Member, memberWithRole } from '../support/access.js';
import { createTestApp, http } from '../support/app.js';
import { bearer, type SignedUp, signUp } from '../support/auth.js';
import { withTenantConnection } from '../support/db.js';

describe('GET /audit-logs (spec 01 §3.4)', () => {
  let app: NestExpressApplication;
  let a: SignedUp;
  let b: SignedUp;
  let accountant: Member;
  let sales: Member;
  let roleId = '';

  const owner = () => a.body.accessToken;

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([signUp(app, { fullName: 'Asha Mehta' }), signUp(app)]);
    accountant = await memberWithRole(app, a.body.tenant.id, 'Accountant');
    sales = await memberWithRole(app, a.body.tenant.id, 'Sales');
    // One role row with an INSERT and five UPDATEs: six audit rows to page through.
    const created = await http(app)
      .post('/api/v1/roles')
      .set('Authorization', bearer(owner()))
      .send({ name: 'Audited', permissions: ['masters.item:view'] })
      .expect(201);
    roleId = (created.body as { id: string }).id;
    for (let version = 1; version <= 5; version++) {
      await http(app)
        .patch(`/api/v1/roles/${roleId}`)
        .set('Authorization', bearer(owner()))
        .send({ description: `Revision ${version}`, version })
        .expect(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const query = async (token: string, params: Record<string, string | number>) =>
    auditLogPageSchema.parse(
      (
        await http(app)
          .get('/api/v1/audit-logs')
          .query(params)
          .set('Authorization', bearer(token))
          .expect(200)
      ).body,
    );

  /** Every page from the first, following `nextCursor`. */
  const allPages = async (token: string, params: Record<string, string | number>) => {
    const pages: AuditLogPage[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await query(token, { ...params, ...(cursor ? { cursor } : {}) });
      pages.push(page);
      cursor = page.meta.nextCursor;
    } while (cursor !== null && pages.length < 20);
    return pages;
  };

  it("pages a row's history newest first with a keyset cursor, without gaps or repeats", async () => {
    const pages = await allPages(owner(), { table: 'roles', rowId: roleId, limit: 2 });
    expect(pages.map((p) => p.data.length)).toEqual([2, 2, 2]);
    expect(pages.map((p) => p.meta.nextCursor === null)).toEqual([false, false, true]);
    const entries = pages.flatMap((p) => p.data);
    expect(new Set(entries.map((e) => e.id)).size).toBe(6);
    expect(entries.map((e) => e.action)).toEqual([
      'UPDATE',
      'UPDATE',
      'UPDATE',
      'UPDATE',
      'UPDATE',
      'INSERT',
    ]);
    expect(entries.map((e) => (e.newData as { version: number } | null)?.version)).toEqual([
      6, 5, 4, 3, 2, 1,
    ]);
    // Microsecond timestamps, strictly ordered (changed_at, id) descending.
    for (const entry of entries) {
      expect(entry.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    }
    const keys = entries.map((e) => `${e.changedAt}|${e.id}`);
    expect([...keys].sort().reverse()).toEqual(keys);
    expect(entries[0]).toMatchObject({
      tableName: 'roles',
      rowId: roleId,
      oldData: { description: 'Revision 4', version: 5 },
      newData: { description: 'Revision 5', version: 6 },
      changedBy: { id: a.body.user.id, name: 'Asha Mehta' },
    });
    expect(entries[0]?.requestId).toEqual(expect.any(String));
  });

  it('filters by user, action and time window', async () => {
    const byOwner = await query(owner(), { userId: a.body.user.id, action: 'UPDATE', limit: 200 });
    expect(byOwner.data.length).toBeGreaterThanOrEqual(5);
    expect(
      byOwner.data.every((e) => e.changedBy?.id === a.body.user.id && e.action === 'UPDATE'),
    ).toBe(true);
    const history = (await query(owner(), { table: 'roles', rowId: roleId })).data;
    const newest = history[0];
    const oldest = history.at(-1);
    if (newest === undefined || oldest === undefined) throw new Error('no history');
    const upToNewest = await query(owner(), {
      table: 'roles',
      rowId: roleId,
      from: oldest.changedAt,
      to: newest.changedAt,
    });
    // `to` is exclusive, `from` inclusive.
    expect(upToNewest.data.map((e) => e.id)).toEqual(history.slice(1).map((e) => e.id));
    const future = await query(owner(), { from: '2999-01-01T00:00:00Z' });
    expect(future).toEqual({ data: [], meta: { limit: 50, nextCursor: null } });
  });

  it('keys company_profile rows by tenant and membership_branches rows by membership', async () => {
    const profile = await query(owner(), { table: 'company_profile' });
    expect(profile.data.map((e) => [e.action, e.rowId])).toEqual([['INSERT', a.body.tenant.id]]);

    const scoped = await memberWithRole(app, a.body.tenant.id, 'Store', {
      branchIds: [await headOfficeId(a.body.tenant.id)],
    });
    const branches = await query(owner(), {
      table: 'membership_branches',
      rowId: scoped.membershipId,
    });
    expect(branches.data.map((e) => [e.action, e.rowId])).toEqual([
      ['INSERT', scoped.membershipId],
    ]);
    // No audit row of this tenant lacks its key.
    const unkeyed = await withTenantConnection(
      a.body.tenant.id,
      async (c) =>
        (
          await c.query<{ n: number }>(
            'select count(*)::int as n from audit_log where row_id is null',
          )
        ).rows,
    );
    expect(unkeyed).toEqual([{ n: 0 }]);
  });

  it("is tenant-isolated: B never sees A's rows, by filter or by paging everything", async () => {
    expect((await query(b.body.accessToken, { table: 'roles', rowId: roleId })).data).toEqual([]);
    const everything = (await allPages(b.body.accessToken, { limit: 200 })).flatMap((p) => p.data);
    expect(everything.length).toBeGreaterThan(0);
    const bRows = everything.filter((e) => e.rowId === roleId || e.rowId === a.body.tenant.id);
    expect(bRows).toEqual([]);
    expect(everything.some((e) => e.rowId === b.body.tenant.id)).toBe(true);
    // A cursor from A's pages leaks nothing into B's.
    const aPage = await query(owner(), { table: 'roles', rowId: roleId, limit: 1 });
    const cursor = aPage.meta.nextCursor;
    if (cursor === null) throw new Error('expected a next page');
    expect(
      (await query(b.body.accessToken, { cursor, table: 'roles', rowId: roleId })).data,
    ).toEqual([]);
  });

  it('needs audit.log:view: Accountant yes, Sales no (403), no session 401', async () => {
    expect((await query(accountant.token, { table: 'roles', rowId: roleId })).data).toHaveLength(6);
    const denied = await http(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', bearer(sales.token))
      .expect(403);
    expect(problemSchema.parse(denied.body)).toMatchObject({
      code: 'FORBIDDEN',
      detail: 'You need the audit.log:view permission.',
    });
    await http(app).get('/api/v1/audit-logs').expect(401);
  });

  it('refuses a forged cursor, a bad filter and an unknown parameter (422)', async () => {
    const forged = Buffer.from('2026-01-01T00:00:00Z|x', 'utf8').toString('base64url');
    for (const params of [
      { cursor: forged },
      { table: 'Users;--' },
      { limit: 500 },
      { tenantId: b.body.tenant.id },
      { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    ]) {
      const res = await http(app)
        .get('/api/v1/audit-logs')
        .query(params)
        .set('Authorization', bearer(owner()));
      expect(res.status, JSON.stringify(params)).toBe(422);
      expect(problemSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    }
  });
});
