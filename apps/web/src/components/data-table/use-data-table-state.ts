import { PAGE_SIZE_DEFAULT } from '@ekaro/contracts';
import {
  functionalUpdate,
  type PaginationState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useDebouncedValue } from '@/lib/use-debounced-value';

/** The list query every paginated endpoint takes (`paginationQuerySchema` + `sort`). */
export interface ListQuery {
  page: number;
  pageSize: number;
  q?: string;
  /** `field:asc` or `field:desc`; the endpoint's contract allow-lists the fields. */
  sort?: string;
}

export interface DataTableState {
  pagination: PaginationState;
  onPaginationChange: (updater: Updater<PaginationState>) => void;
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
  search: string;
  onSearchChange: (search: string) => void;
  /** Put this in the query key and send it: it changes only when the server must be asked. */
  query: ListQuery;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Server-side table state for a list screen. A new search or sort goes back to page 1; the
 * search is debounced before it reaches the query.
 */
export function useDataTableState(
  options: { pageSize?: number; sort?: SortingState } = {},
): DataTableState {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: options.pageSize ?? PAGE_SIZE_DEFAULT,
  });
  const [sorting, setSorting] = useState<SortingState>(options.sort ?? []);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const firstPage = () => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  const query = useMemo<ListQuery>(() => {
    const [first] = sorting;
    return {
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      ...(q === '' ? {} : { q }),
      ...(first === undefined ? {} : { sort: `${first.id}:${first.desc ? 'desc' : 'asc'}` }),
    };
  }, [pagination, sorting, q]);

  return {
    pagination,
    onPaginationChange: (updater) => {
      setPagination((old) => functionalUpdate(updater, old));
    },
    sorting,
    onSortingChange: (updater) => {
      setSorting((old) => functionalUpdate(updater, old));
      firstPage();
    },
    search,
    onSearchChange: (next) => {
      setSearch(next);
      firstPage();
    },
    query,
  };
}
