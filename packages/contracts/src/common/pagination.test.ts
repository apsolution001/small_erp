import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import { paginated, paginationQuerySchema, sortSchema } from './pagination.js';

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
    expect(pathsOf(paginationQuerySchema.safeParse({ page: '0' }))).toEqual(['page']);
    expect(pathsOf(paginationQuerySchema.safeParse({ page: '1.5' }))).toEqual(['page']);
    expect(pathsOf(paginationQuerySchema.safeParse({ pageSize: '201' }))).toEqual(['pageSize']);
    expect(pathsOf(paginationQuerySchema.safeParse({ pageSize: '0' }))).toEqual(['pageSize']);
  });

  it('rejects an empty or overlong search', () => {
    expect(pathsOf(paginationQuerySchema.safeParse({ q: '   ' }))).toEqual(['q']);
    expect(pathsOf(paginationQuerySchema.safeParse({ q: 'x'.repeat(101) }))).toEqual(['q']);
  });

  it('is strict: unknown parameters, including an undeclared sort, are rejected', () => {
    expect(unrecognizedKeysOf(paginationQuerySchema.safeParse({ limit: '10' }))).toEqual(['limit']);
    expect(unrecognizedKeysOf(paginationQuerySchema.safeParse({ sort: 'name:asc' }))).toEqual([
      'sort',
    ]);
  });
});

describe('sortSchema', () => {
  const sort = sortSchema(['code', 'name']);

  it('accepts only the allowed fields with asc or desc', () => {
    expect(sort.parse('code:asc')).toBe('code:asc');
    expect(sort.parse('name:desc')).toBe('name:desc');
    for (const bad of ['tenantId:asc', 'passwordHash:desc', 'name', 'name:up', ':asc', 'code:']) {
      expect(sort.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('reports the sort parameter when a list query rejects it', () => {
    const query = paginationQuerySchema.extend({ sort: sort.optional() });
    expect(query.parse({ sort: 'code:desc' }).sort).toBe('code:desc');
    expect(pathsOf(query.safeParse({ sort: 'createdBy:asc' }))).toEqual(['sort']);
  });

  it('converts to a JSON Schema pattern for the OpenAPI document', () => {
    expect(z.toJSONSchema(sort)).toMatchObject({ type: 'string' });
  });
});

describe('paginated', () => {
  it('wraps an item schema in { data, meta }', () => {
    const schema = paginated(z.object({ id: z.string() }));
    const page = { data: [{ id: 'a' }], meta: { page: 1, pageSize: 25, total: 1 } };
    expect(schema.parse(page)).toEqual(page);
    expect(pathsOf(schema.safeParse({ data: [{ id: 1 }], meta: page.meta }))).toEqual([
      'data.0.id',
    ]);
    expect(
      pathsOf(schema.safeParse({ data: [], meta: { page: 1, pageSize: 25, total: -1 } })),
    ).toEqual(['meta.total']);
  });
});
