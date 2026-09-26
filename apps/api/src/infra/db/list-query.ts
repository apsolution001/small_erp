import { type PageMeta } from '@ekaro/contracts';
import { type AnyColumn, asc, desc, type SQL } from 'drizzle-orm';

export type SortDirection = 'asc' | 'desc';

/**
 * Turns a validated `?sort=field:dir` (the contracts `sortSchema` allow-list) into ORDER BY
 * terms, with `id` as the final tie-breaker so pages are stable. `columns` maps each allowed field
 * to its column, so an unknown field cannot reach SQL.
 */
export function orderByOf<F extends string>(
  sort: `${F}:${SortDirection}` | undefined,
  fallback: `${F}:${SortDirection}`,
  columns: Readonly<Record<F, AnyColumn | SQL>>,
  id: AnyColumn,
): SQL[] {
  const chosen: string = sort ?? fallback;
  const direction: SortDirection = chosen.endsWith(':desc') ? 'desc' : 'asc';
  const column = Object.entries<AnyColumn | SQL>(columns).find(
    ([field]) => chosen === `${field}:${direction}`,
  )?.[1];
  if (column === undefined) throw new Error(`Unsortable field in "${chosen}"`);
  const by = direction === 'asc' ? asc : desc;
  return [by(column), by(id)];
}

/** An ILIKE pattern matching `q` anywhere, with the LIKE wildcards in `q` taken literally. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** An ILIKE pattern matching values that start with `q` (codes, GSTINs, HSNs), escaped likewise. */
export function prefixPattern(q: string): string {
  return `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The OFFSET of a 1-based page (offset pagination is fine for masters and user lists). */
export function pageOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** A page of a list endpoint (backend standard): the shape of `paginated(schema)` in contracts. */
export interface Page<T> {
  readonly data: T[];
  readonly meta: PageMeta;
}

/** Wraps one page of rows with the request's paging and the total count. */
export function pageOf<T>(
  data: T[],
  total: number,
  { page, pageSize }: { readonly page: number; readonly pageSize: number },
): Page<T> {
  return { data, meta: { page, pageSize, total } };
}
