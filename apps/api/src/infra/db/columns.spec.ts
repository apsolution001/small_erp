import { eq, is, SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig, PgDialect, text, unique } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { DB_CASING } from './casing.js';
import { tenantTable } from './columns.js';

const widgets = tenantTable('widgets', { code: text().notNull(), name: text().notNull() }, (t) => [
  unique('widgets_tenant_code_unique').on(t.tenantId, t.code),
]);

const db = drizzle.mock({ casing: DB_CASING });
const dialect = new PgDialect({ casing: DB_CASING });
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('tenantTable()', () => {
  it('adds the standard columns around the business columns, in a stable order', () => {
    expect(getTableConfig(widgets).columns.map((c) => c.name)).toEqual([
      'id',
      'tenantId',
      'code',
      'name',
      'createdAt',
      'createdBy',
      'updatedAt',
      'updatedBy',
      'version',
    ]);
  });

  it('exposes the standard columns in the table type (composite FKs reference them)', () => {
    expectTypeOf(widgets).toHaveProperty('id');
    expectTypeOf(widgets).toHaveProperty('tenantId');
    expectTypeOf(widgets).toHaveProperty('version');
    expect(getTableConfig(widgets).columns).toContain(widgets.tenantId);
  });

  it('references tenants(id) and keeps extra config', () => {
    const config = getTableConfig(widgets);
    expect(config.foreignKeys.map((fk) => fk.reference().foreignTable)).toHaveLength(1);
    expect(getTableConfig(config.foreignKeys[0]!.reference().foreignTable).name).toBe('tenants');
    expect(config.uniqueConstraints.map((u) => u.name)).toEqual(['widgets_tenant_code_unique']);
  });

  it('declares DB defaults that read tenant and actor from the transaction context', () => {
    const sqlDefaults = getTableConfig(widgets).columns.flatMap((c) =>
      is(c.default, SQL) ? [[c.name, dialect.sqlToQuery(c.default).sql] as const] : [],
    );
    expect(getTableConfig(widgets).columns.find((c) => c.name === 'version')?.default).toBe(1);
    expect(Object.fromEntries(sqlDefaults)).toEqual({
      tenantId: 'app_current_tenant()',
      createdAt: 'now()',
      createdBy: 'app_current_user()',
      updatedAt: 'now()',
      updatedBy: 'app_current_user()',
    });
  });

  it('on insert: generates a UUIDv7 id in the app and leaves the rest to DB defaults', () => {
    const query = db.insert(widgets).values({ code: 'W1', name: 'Widget' }).toSQL();
    expect(query.sql).toBe(
      'insert into "widgets" ("id", "tenant_id", "code", "name", "created_at", "created_by", "updated_at", "updated_by", "version") ' +
        'values ($1, default, $2, $3, default, default, default, default, default)',
    );
    expect(query.params[0]).toMatch(UUID_V7);
    expect(query.params.slice(1)).toEqual(['W1', 'Widget']);
  });

  it('on update: stamps updated_at and updated_by from the DB', () => {
    const query = db.update(widgets).set({ name: 'Renamed' }).where(eq(widgets.code, 'W1')).toSQL();
    expect(query.sql).toBe(
      'update "widgets" set "name" = $1, "updated_at" = now(), "updated_by" = app_current_user() where "widgets"."code" = $2',
    );
  });
});
