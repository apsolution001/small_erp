import { z } from 'zod';

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 200;

/** `?page=&pageSize=&sort=field:asc&q=` (backend standard). Query strings are coerced. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  sort: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9]*:(asc|desc)$/, 'Expected field:asc or field:desc')
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

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

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}
