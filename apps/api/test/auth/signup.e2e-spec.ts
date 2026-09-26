import { DOC_TYPES, gstinLookupResponseSchema, PERMISSIONS, problemSchema } from '@ekaro/contracts';
import { currentFy, fyRange, fyShort } from '@ekaro/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../../src/modules/auth/sessions/refresh-token.js';
import { refreshTokens } from '../../src/modules/auth/sessions/refresh-tokens.schema.js';
import { sessions } from '../../src/modules/auth/sessions/sessions.schema.js';
import { users } from '../../src/modules/auth/users/users.schema.js';
import { TenantBootstrapService } from '../../src/modules/platform/index.js';
import { cancelledGstin } from '../factories/gstin.js';
import { createTestApp, http } from '../support/app.js';
import {
  me,
  refreshSetCookie,
  refreshTokenOf,
  type SignedUp,
  signupInput,
} from '../support/auth.js';
import { testPlatformDb, withTenantConnection } from '../support/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('POST /api/v1/auth/signup', () => {
  let app: NestExpressApplication;
  let owner: SignedUp;
  let setCookie: string | undefined;

  beforeAll(async () => {
    app = await createTestApp();
    const input = signupInput({ fullName: 'Asha Mehta', mobile: '+919812345678' });
    const res = await http(app).post('/api/v1/auth/signup').send(input).expect(201);
    setCookie = refreshSetCookie(res);
    owner = {
      body: res.body as SignedUp['body'],
      refreshToken: refreshTokenOf(res),
      email: input.email,
      password: input.password,
      gstin: input.gstin,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  const tenantId = () => owner.body.tenant.id;
  const rows = <T extends Record<string, unknown>>(query: string) =>
    withTenantConnection(tenantId(), async (c) => (await c.query<T>(query)).rows);

  describe('happy path', () => {
    it('returns the session: user, trial tenant named after the trade name, Owner membership', () => {
      const pan = owner.gstin.slice(2, 12);
      expect(owner.body).toMatchObject({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/) as string,
        user: { email: owner.email, fullName: 'Asha Mehta', mobile: '+919812345678' },
        tenant: {
          name: `${pan} Traders`,
          slug: `${pan.toLowerCase()}-traders`,
          status: 'trial',
          plan: 'growth',
        },
        membership: { role: { name: 'Owner' }, allBranches: true, branchIds: [], status: 'active' },
      });
      const trialEnds = Date.parse(owner.body.tenant.trialEndsAt ?? '');
      expect(Math.round((trialEnds - Date.now()) / DAY_MS)).toBe(14);
    });

    it('sets the __Secure- refresh cookie httpOnly, Secure, SameSite=Strict on /api/v1/auth for 7 days', () => {
      expect(setCookie).toMatch(/^__Secure-ekaro_refresh=[\w-]{43};/);
      const attributes = setCookie?.split('; ').slice(1) ?? [];
      expect(attributes).toEqual(
        expect.arrayContaining(['Path=/api/v1/auth', 'HttpOnly', 'Secure', 'SameSite=Strict']),
      );
      const expires = Date.parse(attributes.find((a) => a.startsWith('Expires='))?.slice(8) ?? '');
      // Idle lifetime; the session itself ends 30 days after signup whatever the activity.
      expect(Math.round((expires - Date.now()) / DAY_MS)).toBe(7);
      expect(JSON.stringify(owner.body)).not.toContain(owner.refreshToken);
    });

    it('stores the password with bcrypt cost 12 and the refresh token only as its SHA-256', async () => {
      const db = testPlatformDb();
      const [user] = await db.select().from(users).where(eq(users.email, owner.email));
      expect(user?.passwordHash).toMatch(/^\$2b\$12\$/);
      const tokens = await db
        .select({ tokenHash: refreshTokens.tokenHash, revokedAt: refreshTokens.revokedAt })
        .from(refreshTokens)
        .innerJoin(sessions, eq(sessions.id, refreshTokens.familyId))
        .where(eq(sessions.userId, owner.body.user.id));
      expect(tokens).toEqual([
        { tokenHash: hashRefreshToken(owner.refreshToken), revokedAt: null },
      ]);
    });

    it('seeds the company profile from the GSTIN registration, books from the FY start', async () => {
      const pan = owner.gstin.slice(2, 12);
      expect(
        await rows(`select legal_name, trade_name, gstin, pan, state_code, city, email, phone,
                           books_begin_date::text, valuation_method from company_profile`),
      ).toEqual([
        {
          legal_name: `${pan} Private Limited`,
          trade_name: `${pan} Traders`,
          gstin: owner.gstin,
          pan,
          state_code: '27',
          city: 'Maharashtra',
          email: owner.email,
          phone: '+919812345678',
          books_begin_date: fyRange(currentFy()).start,
          valuation_method: 'weighted_average',
        },
      ]);
    });

    it('seeds the head office at the registered address and its Main godown', async () => {
      const [ho] = await rows<{ id: string }>(
        `select id, code, name, gstin, state_code, is_head_office, is_active from branches`,
      );
      expect(ho).toMatchObject({
        code: 'HO',
        name: 'Head Office',
        gstin: owner.gstin,
        state_code: '27',
        is_head_office: true,
        is_active: true,
      });
      expect(await rows('select branch_id, code, name, is_active from godowns')).toEqual([
        { branch_id: ho?.id, code: 'MAIN', name: 'Main', is_active: true },
      ]);
    });

    it('seeds the nine system roles, the Owner storing no permissions', async () => {
      const roles = await rows<{ name: string; is_owner: boolean; permissions: string[] }>(
        'select name, is_system, is_owner, is_billable, permissions from roles order by name',
      );
      expect(roles.map((r) => r.name)).toEqual([
        'Accountant',
        'Admin',
        'CA',
        'Owner',
        'Production',
        'Purchase',
        'Sales',
        'Store',
        'Viewer',
      ]);
      expect(roles.filter((r) => r.is_owner)).toEqual([
        { name: 'Owner', is_system: true, is_owner: true, is_billable: true, permissions: [] },
      ]);
    });

    it('seeds the UQC units and the GST slabs', async () => {
      const units = await rows<{ code: string; uqc: string }>(
        'select code, uqc from units order by code',
      );
      expect(units).toHaveLength(18);
      expect(units.every((u) => u.code === u.uqc)).toBe(true);
      expect(
        await rows(`select name, gst_rate::text, is_exempt, is_nil_rated, is_active
                      from tax_rates order by is_active desc, tax_rates.gst_rate, name`),
      ).toEqual([
        {
          name: 'Exempt',
          gst_rate: '0.0000',
          is_exempt: true,
          is_nil_rated: false,
          is_active: true,
        },
        {
          name: 'Nil Rated',
          gst_rate: '0.0000',
          is_exempt: false,
          is_nil_rated: true,
          is_active: true,
        },
        {
          name: 'GST 0.25%',
          gst_rate: '0.2500',
          is_exempt: false,
          is_nil_rated: false,
          is_active: true,
        },
        {
          name: 'GST 1.5%',
          gst_rate: '1.5000',
          is_exempt: false,
          is_nil_rated: false,
          is_active: true,
        },
        {
          name: 'GST 3%',
          gst_rate: '3.0000',
          is_exempt: false,
          is_nil_rated: false,
          is_active: true,
        },
        {
          name: 'GST 5%',
          gst_rate: '5.0000',
          is_exempt: false,
          is_nil_rated: false,
          is_active: true,
        },
        {
          name: 'GST 18%',
          gst_rate: '18.0000',
          is_exempt: false,
          is_nil_rated: false,
          is_active: true,
        },
        {
          name: 'GST 40%',
          gst_rate: '40.0000',
          is_exempt: false,
          is_nil_rated: false,
          is_active: true,
        },
        {
          name: 'GST 12%',
          gst_rate: '12.0000',
          is_exempt: false,
          is_nil_rated: false,
          is_active: false,
        },
        {
          name: 'GST 28%',
          gst_rate: '28.0000',
          is_exempt: false,
          is_nil_rated: false,
          is_active: false,
        },
      ]);
    });

    it('seeds a default series for every document type in the current FY, like SI/26-27/0001', async () => {
      const fy = currentFy();
      const series = await rows<{ doc_type: string; prefix: string; first: string }>(
        `select doc_type, prefix, fy, is_default, next_number::text,
                prefix || lpad(next_number::text, padding, '0') || suffix as first
           from document_series`,
      );
      expect(series.map((s) => s.doc_type).sort()).toEqual([...DOC_TYPES].sort());
      expect(series.every((s) => s.first.length <= 16)).toBe(true);
      expect(series.find((s) => s.doc_type === 'sales_invoice')).toMatchObject({
        prefix: `SI/${fyShort(fy)}/`,
        fy,
        is_default: true,
        next_number: '1',
        first: `SI/${fyShort(fy)}/0001`,
      });
      expect(series.find((s) => s.doc_type === 'purchase_order')?.first).toBe(
        `PO/${fyShort(fy)}/0001`,
      );
    });

    it('makes the user the active Owner of the tenant', async () => {
      expect(
        await rows(`select m.id, m.user_id, r.name as role, m.all_branches, m.status
                      from memberships m join roles r on r.id = m.role_id`),
      ).toEqual([
        {
          id: owner.body.membership.id,
          user_id: owner.body.user.id,
          role: 'Owner',
          all_branches: true,
          status: 'active',
        },
      ]);
    });

    it('audits every seeded row as written by the owner', async () => {
      const audit = await rows<{ table_name: string; n: number }>(
        `select table_name, count(*)::int as n from audit_log
          where action = 'INSERT' and changed_by = '${owner.body.user.id}'
          group by table_name order by table_name`,
      );
      expect(audit).toEqual([
        { table_name: 'branches', n: 1 },
        { table_name: 'company_profile', n: 1 },
        { table_name: 'document_series', n: DOC_TYPES.length },
        { table_name: 'godowns', n: 1 },
        { table_name: 'memberships', n: 1 },
        { table_name: 'roles', n: 9 },
        { table_name: 'tax_rates', n: 10 },
        { table_name: 'units', n: 18 },
      ]);
    });

    it('lets the owner call /auth/me and see every permission', async () => {
      const session = await me(app, owner.body.accessToken);
      expect(session).toEqual({
        user: owner.body.user,
        tenant: owner.body.tenant,
        membership: owner.body.membership,
        permissions: [...PERMISSIONS],
      });
    });

    it('bootstraps idempotently: running it again adds nothing', async () => {
      const count = () =>
        rows<{ n: number }>(
          `select (select count(*) from roles) + (select count(*) from units)
                + (select count(*) from tax_rates) + (select count(*) from document_series)
                + (select count(*) from branches) + (select count(*) from godowns)
                + (select count(*) from company_profile) + (select count(*) from memberships) as n`,
        );
      const before = await count();
      const registration = gstinLookupResponseSchema.parse(
        (await http(app).get(`/api/v1/platform/gstin/${owner.gstin}`).expect(200)).body,
      );
      const result = await testPlatformDb().transaction((tx) =>
        app.get(TenantBootstrapService).bootstrap(tx, {
          tenantId: tenantId(),
          ownerUserId: owner.body.user.id,
          registration,
          ownerEmail: owner.email,
          ownerMobile: null,
          now: new Date(),
        }),
      );
      expect(result.membershipId).toBe(owner.body.membership.id);
      expect(await count()).toEqual(before);
    });
  });

  describe('rejections', () => {
    const problem = (body: unknown) => problemSchema.parse(body);

    it('409 EMAIL_TAKEN for a registered email, whatever its case', async () => {
      const res = await http(app)
        .post('/api/v1/auth/signup')
        .send(signupInput({ email: owner.email.toUpperCase() }))
        .expect(409);
      expect(problem(res.body)).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' });
    });

    it('422 GSTIN_INACTIVE for a cancelled registration, and creates nothing', async () => {
      const input = signupInput({ gstin: cancelledGstin() });
      const res = await http(app).post('/api/v1/auth/signup').send(input).expect(422);
      expect(problem(res.body)).toMatchObject({ code: 'GSTIN_INACTIVE' });
      expect(
        await testPlatformDb().select().from(users).where(eq(users.email, input.email)),
      ).toEqual([]);
    });

    it('422 VALIDATION_FAILED for a bad GSTIN checksum, a common password or an unknown key', async () => {
      const bad = [
        { gstin: `${owner.gstin.slice(0, 14)}${owner.gstin.endsWith('A') ? 'B' : 'A'}` },
        { password: 'Password@123' },
        { acceptTerms: false },
      ];
      for (const override of bad) {
        const res = await http(app)
          .post('/api/v1/auth/signup')
          .send({ ...signupInput(), ...override })
          .expect(422);
        expect(problem(res.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      const extra = await http(app)
        .post('/api/v1/auth/signup')
        .send({ ...signupInput(), tenantId: tenantId() })
        .expect(422);
      expect(problem(extra.body).errors).toEqual([
        expect.objectContaining({ code: 'unrecognized_keys' }),
      ]);
    });
  });
});

describe('GET /api/v1/platform/gstin/:gstin', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is public and returns the registration for auto-fill', async () => {
    const gstin = cancelledGstin('07');
    const res = await http(app).get(`/api/v1/platform/gstin/${gstin.toLowerCase()}`).expect(200);
    expect(gstinLookupResponseSchema.parse(res.body)).toMatchObject({
      gstin,
      status: 'Cancelled',
      stateCode: '07',
      address: { city: 'Delhi', stateCode: '07' },
    });
  });

  it('422 for a GSTIN that fails its checksum', async () => {
    const res = await http(app).get('/api/v1/platform/gstin/27AAPFU0939F1ZA').expect(422);
    expect(problemSchema.parse(res.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
