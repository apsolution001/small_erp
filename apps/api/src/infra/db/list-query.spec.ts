import { type AnyColumn } from 'drizzle-orm';
import { PgDialect, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { containsPattern, orderByOf, pageOf, pageOffset, prefixPattern } from './list-query.js';

const things = pgTable('things', { id: uuid().primaryKey(), code: text(), name: text() });
const dialect = new PgDialect();
const render = (parts: ReturnType<typeof orderByOf>) =>
  parts.map((part) => dialect.sqlToQuery(part).sql).join(', ');

describe('list query helpers', () => {
  it('computes offsets and wraps a page', () => {
    expect(pageOffset({ page: 1, pageSize: 25 })).toBe(0);
    expect(pageOffset({ page: 3, pageSize: 50 })).toBe(100);
    expect(pageOf(['a'], 7, { page: 2, pageSize: 1 })).toEqual({
      data: ['a'],
      meta: { page: 2, pageSize: 1, total: 7 },
    });
  });

  it('orders by the allowed column, then the id, falling back to the default sort', () => {
    const columns = { code: things.code, name: things.name };
    expect(render(orderByOf('name:desc', 'code:asc', columns, things.id))).toBe(
      '"things"."name" desc, "things"."id" asc',
    );
    expect(render(orderByOf(undefined, 'code:asc', columns, things.id))).toBe(
      '"things"."code" asc, "things"."id" asc',
    );
  });

  it('refuses a sort field that has no column (a programming error)', () => {
    // A map that lies about its fields, as a mismatch between contracts and repository would.
    const columns: Partial<Record<'code' | 'id', AnyColumn>> = { code: things.code };
    expect(() =>
      orderByOf('id:asc', 'code:asc', columns as Record<'code' | 'id', AnyColumn>, things.id),
    ).toThrow(/not a sortable/);
  });

  it('escapes LIKE wildcards in search terms', () => {
    expect(containsPattern('steel')).toBe('%steel%');
    expect(containsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(prefixPattern('27AA')).toBe('27AA%');
    expect(prefixPattern('A_B')).toBe('A\\_B%');
  });
});
