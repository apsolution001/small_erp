import { uuidv7 } from '@ekaro/core';
import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Injectable,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { TransactionHost } from '@nestjs-cls/transactional';
import { sql } from 'drizzle-orm';
import { type Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Public } from '../../src/common/decorators/public.decorator.js';
import { type AppTransactionalAdapter } from '../../src/infra/db/app-db.js';
import { type RequestContext } from '../../src/infra/tenancy/request-context.js';
import { TenantContext } from '../../src/infra/tenancy/tenant-context.js';
import { type Tenant } from '../../src/modules/platform/tenants/tenants.schema.js';
import { createTestTenant } from '../factories/tenants.js';
import { createTestApp, http } from '../support/app.js';
import { createProbeTable, dropTable, withTenantConnection } from '../support/db.js';

interface DbContext {
  tenant: string | null;
  user: string | null;
  request: string | null;
  sameTransaction: boolean;
}

let probeTable = '';

/** Stands in for the JWT guard (T-104): puts tenant and user into CLS from test headers. */
@Injectable()
class HeaderAuthGuard implements CanActivate {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = req.header('x-test-tenant');
    const userId = req.header('x-test-user');
    if (tenantId !== undefined) this.cls.set('tenantId', tenantId);
    if (userId !== undefined) this.cls.set('userId', userId);
    return true;
  }
}

@Controller('tx-probe')
@UseGuards(HeaderAuthGuard)
// Justification: test-only probe; authentication is simulated by HeaderAuthGuard.
@Public()
class TxProbeController {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  /** Two statements: `now()` is frozen for a transaction, so equal values mean one transaction. */
  @Get('context')
  async context(): Promise<DbContext> {
    const first = await this.txHost.tx.execute<{ at: string }>(sql`select now()::text as at`);
    const { rows } = await this.txHost.tx.execute<
      Omit<DbContext, 'sameTransaction'> & { at: string }
    >(
      sql`select pg_sleep(0.01), now()::text as at, app_current_tenant() as tenant,
                 app_current_user() as "user", app_current_request() as request`,
    );
    const { at, tenant, user, request } = rows[0]!;
    return { tenant, user, request, sameTransaction: at === first.rows[0]!.at };
  }

  @Get('names')
  async names(): Promise<string[]> {
    const { rows } = await this.txHost.tx.execute<{ name: string }>(
      sql.raw(`select name from ${probeTable} order by name`),
    );
    return rows.map((r) => r.name);
  }

  @Post('rows')
  async create(@Body() body: { name: string; fail?: boolean }): Promise<{ id: string }> {
    const { rows } = await this.txHost.tx.execute<{ id: string }>(
      sql`insert into ${sql.identifier(probeTable)} (name) values (${body.name}) returning id`,
    );
    if (body.fail === true) throw new Error('fail after insert');
    return rows[0]!;
  }
}

@Module({ controllers: [TxProbeController], providers: [HeaderAuthGuard] })
class TxProbeModule {}

describe('tenant transaction per request (TenantTxInterceptor)', () => {
  let app: NestExpressApplication;
  let tenantA: Tenant;
  let tenantB: Tenant;
  const userA = uuidv7();

  beforeAll(async () => {
    probeTable = await createProbeTable('test_tx_probe');
    [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
    // One pooled connection, so every request reuses the previous request's connection.
    app = await createTestApp({ imports: [TxProbeModule], env: { DB_POOL_MAX: 1 } });
  });

  afterAll(async () => {
    await app.close();
    await dropTable(probeTable);
  });

  const asTenant = (tenantId: string, userId = userA) => ({
    'x-test-tenant': tenantId,
    'x-test-user': userId,
  });

  it('runs an authenticated request in a transaction with the tenant, user and request id set', async () => {
    const res = await http(app)
      .get('/api/v1/tx-probe/context')
      .set(asTenant(tenantA.id))
      .set('x-request-id', 'req-ctx-1')
      .expect(200);
    expect(res.body).toEqual({
      tenant: tenantA.id,
      user: userA,
      request: 'req-ctx-1',
      sameTransaction: true,
    });
  });

  it('leaves requests without a tenant outside any tenant context, even on a reused connection', async () => {
    await http(app).get('/api/v1/tx-probe/context').set(asTenant(tenantA.id)).expect(200);
    const res = await http(app).get('/api/v1/tx-probe/context').expect(200);
    expect(res.body).toEqual({ tenant: null, user: null, request: null, sameTransaction: false });
  });

  it('commits the write and audits it with the acting user and request id', async () => {
    const res = await http(app)
      .post('/api/v1/tx-probe/rows')
      .set(asTenant(tenantA.id))
      .set('x-request-id', 'req-write-1')
      .send({ name: 'committed' })
      .expect(201);
    const id = (res.body as { id: string }).id;

    const audit = await withTenantConnection(tenantA.id, async (c) => {
      const { rows } = await c.query<{
        action: string;
        changed_by: string | null;
        request_id: string | null;
        tenant_id: string;
      }>('select action, changed_by, request_id, tenant_id from audit_log where row_id = $1', [id]);
      return rows;
    });
    expect(audit).toEqual([
      { action: 'INSERT', changed_by: userA, request_id: 'req-write-1', tenant_id: tenantA.id },
    ]);
  });

  it('rolls the whole request back when the handler throws', async () => {
    await http(app)
      .post('/api/v1/tx-probe/rows')
      .set(asTenant(tenantA.id))
      .send({ name: 'rolled-back', fail: true })
      .expect(500);
    const names = await http(app)
      .get('/api/v1/tx-probe/names')
      .set(asTenant(tenantA.id))
      .expect(200);
    expect(names.body).not.toContain('rolled-back');
  });

  it('isolates tenants across requests on the same connection', async () => {
    await http(app)
      .post('/api/v1/tx-probe/rows')
      .set(asTenant(tenantB.id))
      .send({ name: 'b-only' })
      .expect(201);
    const a = await http(app).get('/api/v1/tx-probe/names').set(asTenant(tenantA.id)).expect(200);
    const b = await http(app).get('/api/v1/tx-probe/names').set(asTenant(tenantB.id)).expect(200);
    expect(a.body).toEqual(['committed']);
    expect(b.body).toEqual(['b-only']);
  });
});

describe('TenantContext.runInTenant (jobs)', () => {
  let app: NestExpressApplication;
  let tenant: Tenant;

  beforeAll(async () => {
    tenant = await createTestTenant();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const current = (txHost: TransactionHost<AppTransactionalAdapter>) =>
    txHost.tx
      .execute<{ tenant: string | null; user: string | null; request: string | null }>(
        sql`select app_current_tenant() as tenant, app_current_user() as "user", app_current_request() as request`,
      )
      .then((r) => r.rows[0]!);

  it('runs the callback in a transaction as the given tenant and user', async () => {
    const tenantContext = app.get(TenantContext);
    const txHost = app.get<TransactionHost<AppTransactionalAdapter>>(TransactionHost);
    const userId = uuidv7();
    const seen = await tenantContext.runInTenant(tenant.id, userId, () => current(txHost));
    expect(seen).toMatchObject({ tenant: tenant.id, user: userId });
    expect(seen.request).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('supports system jobs without a user, and does not leak the context afterwards', async () => {
    const tenantContext = app.get(TenantContext);
    const txHost = app.get<TransactionHost<AppTransactionalAdapter>>(TransactionHost);
    const seen = await tenantContext.runInTenant(tenant.id, null, () => current(txHost));
    expect(seen).toMatchObject({ tenant: tenant.id, user: null });
    expect(tenantContext.tenantId).toBeUndefined();
  });

  it('opens a new transaction for a nested tenant, never joining the outer one', async () => {
    const tenantContext = app.get(TenantContext);
    const txHost = app.get<TransactionHost<AppTransactionalAdapter>>(TransactionHost);
    const other = await createTestTenant();
    const [outerBefore, inner, outerAfter] = await tenantContext.runInTenant(
      tenant.id,
      null,
      async () => {
        const before = await current(txHost);
        const nested = await tenantContext.runInTenant(other.id, null, () => current(txHost));
        return [before, nested, await current(txHost)];
      },
    );
    expect(outerBefore.tenant).toBe(tenant.id);
    expect(inner.tenant).toBe(other.id);
    expect(outerAfter.tenant).toBe(tenant.id);
  });
});

describe('TenantContext.afterCommit', () => {
  let app: NestExpressApplication;
  let tenant: Tenant;
  let table = '';

  beforeAll(async () => {
    tenant = await createTestTenant();
    table = await createProbeTable('test_after_commit');
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await dropTable(table);
  });

  const insert = (txHost: TransactionHost<AppTransactionalAdapter>, name: string) =>
    txHost.tx.execute(sql`insert into ${sql.identifier(table)} (name) values (${name})`);

  const committed = (name: string) =>
    withTenantConnection(tenant.id, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from ${table} where name = $1`,
        [name],
      );
      return rows[0]?.n;
    });

  it('runs callbacks after the commit, in order, when the data is visible to others', async () => {
    const tenantContext = app.get(TenantContext);
    const txHost = app.get<TransactionHost<AppTransactionalAdapter>>(TransactionHost);
    const events: string[] = [];
    await tenantContext.runInTenant(tenant.id, null, async () => {
      await insert(txHost, 'after-commit');
      tenantContext.afterCommit(async () => {
        events.push(`first:${String(await committed('after-commit'))}`);
      });
      tenantContext.afterCommit(() => {
        events.push('second');
        return Promise.resolve();
      });
      events.push('body done');
    });
    expect(events).toEqual(['body done', 'first:1', 'second']);
  });

  it('never runs them after a rollback', async () => {
    const tenantContext = app.get(TenantContext);
    const txHost = app.get<TransactionHost<AppTransactionalAdapter>>(TransactionHost);
    const events: string[] = [];
    await expect(
      tenantContext.runInTenant(tenant.id, null, async () => {
        await insert(txHost, 'rolled-back');
        tenantContext.afterCommit(() => {
          events.push('ran');
          return Promise.resolve();
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(events).toEqual([]);
    expect(await committed('rolled-back')).toBe(0);
  });

  it('logs a failing callback without failing the committed work, and runs the rest', async () => {
    const tenantContext = app.get(TenantContext);
    const events: string[] = [];
    await tenantContext.runInTenant(tenant.id, null, () => {
      tenantContext.afterCommit(() => Promise.reject(new Error('cache down')));
      tenantContext.afterCommit(() => {
        events.push('still ran');
        return Promise.resolve();
      });
      return Promise.resolve();
    });
    expect(events).toEqual(['still ran']);
  });

  it('refuses to queue a callback outside a tenant transaction', () => {
    expect(() => {
      app.get(TenantContext).afterCommit(() => Promise.resolve());
    }).toThrow('afterCommit() needs a tenant transaction');
  });
});
