import { PgDialect, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { containsPattern, orderByOf, pageOf, pageOffset, prefixPattern } from './list-query.js';

const things = pgTable('things', { id: uuid(), name: text(), code: text() });
const dialect = new PgDialect();
const render = (terms: ReturnType<typeof orderByOf>) =>
  dialect.sqlToQuery(sql.join(terms, sql`, `)).sql;

describe('orderByOf', () => {
  const columns = { name: things.name, code: things.code };

  it('orders by the chosen field and direction, then by id', () => {
    expect(render(orderByOf<'name' | 'code'>('code:desc', 'name:asc', columns, things.id))).toBe(
      '"things"."code" desc, "things"."id" desc',
    );
  });

  it('falls back to the default sort', () => {
    expect(render(orderByOf<'name' | 'code'>(undefined, 'name:asc', columns, things.id))).toBe(
      '"things"."name" asc, "things"."id" asc',
    );
  });

  it('refuses a field without a column (never reaches SQL)', () => {
    expect(() =>
      orderByOf<'name' | 'secret'>(
        'secret:asc',
        'name:asc',
        { name: things.name } as never,
        things.id,
      ),
    ).toThrow('Unsortable field in "secret:asc"');
  });
});

describe('containsPattern', () => {
  it('wraps in wildcards and escapes LIKE metacharacters', () => {
    expect(containsPattern('ram')).toBe('%ram%');
    expect(containsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('prefixPattern', () => {
  it('matches a prefix and escapes LIKE metacharacters', () => {
    expect(prefixPattern('27AA')).toBe('27AA%');
    expect(prefixPattern('A_B')).toBe('A\\_B%');
  });
});

describe('pageOf', () => {
  it('wraps rows with the paging and the total', () => {
    expect(pageOf(['a'], 7, { page: 2, pageSize: 1 })).toEqual({
      data: ['a'],
      meta: { page: 2, pageSize: 1, total: 7 },
    });
  });
});

describe('pageOffset', () => {
  it('is zero on page 1', () => {
    expect(pageOffset(1, 25)).toBe(0);
    expect(pageOffset(3, 25)).toBe(50);
  });
});
