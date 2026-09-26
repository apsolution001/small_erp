import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { paginated, paginationQuerySchema } from './pagination.js';

describe('paginationQuerySchema', () => {
  it('coerces query-string numbers and applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '200', q: ' steel ' })).toEqual({
      page: 3,
      pageSize: 200,
      q: 'steel',
    });
  });

  it('bounds page and pageSize', () => {
    for (const bad of [{ page: '0' }, { pageSize: '201' }, { pageSize: '0' }, { page: '1.5' }]) {
      expect(paginationQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('accepts sort as field:asc|desc', () => {
    expect(paginationQuerySchema.parse({ sort: 'name:desc' }).sort).toBe('name:desc');
    for (const bad of ['name', 'name:up', ':asc', 'na me:asc']) {
      expect(paginationQuerySchema.safeParse({ sort: bad }).success, bad).toBe(false);
    }
  });

  it('rejects an empty or overlong search', () => {
    expect(paginationQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('paginated', () => {
  it('wraps an item schema in { data, meta }', () => {
    const schema = paginated(z.object({ id: z.string() }));
    const page = { data: [{ id: 'a' }], meta: { page: 1, pageSize: 25, total: 1 } };
    expect(schema.parse(page)).toEqual(page);
    expect(schema.safeParse({ data: [{ id: 1 }], meta: page.meta }).success).toBe(false);
    expect(schema.safeParse({ data: [], meta: { page: 1, pageSize: 25, total: -1 } }).success).toBe(
      false,
    );
  });
});
