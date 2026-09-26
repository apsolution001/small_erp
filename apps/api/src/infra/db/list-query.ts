import { type PageMeta } from '@ekaro/contracts';
import { type AnyColumn, asc, desc, type SQL } from 'drizzle-orm';

/** A page of a list endpoint (backend standard): the shape of `paginated(schema)` in contracts. */
export interface Page<T> {
  readonly data: T[];
  readonly meta: PageMeta;
}

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export type SortDirection = 'asc' | 'desc';
export type SortParam<F extends string> = `${F}:${SortDirection}`;

/** The `OFFSET` of a page (offset pagination is fine for masters, database standard). */
export function pageOffset({ page, pageSize }: PageRequest): number {
  return (page - 1) * pageSize;
}

export function pageOf<T>(data: T[], total: number, { page, pageSize }: PageRequest): Page<T> {
  return { data, meta: { page, pageSize, total } };
}

/**
 * `ORDER BY` for `?sort=field:dir`. `sort` was validated against the list's allow-list
 * (`sortSchema` in contracts), and `columns` maps each allowed field to its column, so no
 * client value ever reaches SQL. `tieBreaker` (the primary key) keeps pages stable.
 */
export function orderByOf<F extends string>(
  sort: SortParam<F> | undefined,
  fallback: SortParam<F>,
  columns: Readonly<Record<F, AnyColumn>>,
  tieBreaker: AnyColumn,
): SQL[] {
  const wanted = sort ?? fallback;
  for (const [field, column] of Object.entries<AnyColumn>(columns)) {
    if (wanted === `${field}:asc`) return [asc(column), asc(tieBreaker)];
    if (wanted === `${field}:desc`) return [desc(column), asc(tieBreaker)];
  }
  throw new Error(`orderByOf: "${wanted}" is not a sortable column`);
}

/**
 * `ILIKE` pattern for "contains `q`", with the LIKE wildcards in `q` escaped (backslash is the
 * default LIKE escape character in Postgres).
 */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

/** `ILIKE` pattern for "starts with `q`" (codes and GSTINs), wildcards escaped. */
export function prefixPattern(q: string): string {
  return `${q.replace(/[\\%_]/g, '\\$&')}%`;
}
