import { z } from 'zod';

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 200;

/**
 * `?page=&pageSize=&q=` (backend standard). Query strings are coerced. It is strict, so an
 * unknown query parameter is a 422. Each list query extends it with its filters and its own
 * `sort` allow-list ({@link sortSchema}).
 */
export const paginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  q: z.string().trim().min(1).max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * `?sort=field:asc|desc`, limited to the columns a list allows, so a client can never sort on
 * (or probe) an arbitrary column.
 */
export function sortSchema<const F extends readonly [string, ...string[]]>(allowedFields: F) {
  return z.templateLiteral([z.enum(allowedFields), ':', z.enum(['asc', 'desc'])]);
}

export const pageMetaSchema = z.object({
  page: z.int().min(1),
  pageSize: z.int().min(1),
  total: z.int().min(0),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

/** A page of results: `{ data, meta: { page, pageSize, total } }`. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: pageMetaSchema });
}
