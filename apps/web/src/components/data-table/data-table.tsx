import {
  FlexRender,
  type Header,
  type PaginationState,
  type RowData,
  type SortingState,
  type Updater,
  useTable,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, SearchXIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableDensity,
} from '@/components/ui/table';
import { useHotkey } from '@/lib/hotkeys';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '../states';
import { DataTablePagination } from './data-table-pagination';
import { DataTableToolbar } from './data-table-toolbar';
import { type DataTableColumn, dataTableFeatures, type DataTableFeatures } from './features';
import { useRowNavigation } from './use-row-navigation';

export interface DataTableProps<TData extends RowData> {
  /** Accessible name of the table, e.g. "Parties". */
  label: string;
  columns: DataTableColumn<TData>[];
  /** The current page of rows; undefined until the first load. */
  data: TData[] | undefined;
  /** Total rows on the server (`meta.total`). */
  rowCount: number | undefined;
  getRowId: (row: TData) => string;
  pagination: PaginationState;
  onPaginationChange: (updater: Updater<PaginationState>) => void;
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
  /** Omit both to hide the search box. */
  search?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;
  isLoading?: boolean;
  /** A background refetch (new page, new sort): the old rows stay, dimmed. */
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Enter or double-click on a row. */
  onRowOpen?: (row: TData) => void;
  /** Shown when there are no rows and no search (usually with a "New …" action). */
  empty?: ReactNode;
  /** Filters and actions for the toolbar. */
  toolbar?: ReactNode;
  density?: TableDensity;
}

const EMPTY: never[] = [];
const SKELETON_ROWS = 8;

/**
 * The list grid of every masters and document screen (frontend standard): server-side
 * pagination, sorting and search, column visibility, keyboard row navigation, and explicit
 * loading, empty and error states. Page sizes stop at 200, so no page needs virtualising.
 */
export function DataTable<TData extends RowData>(props: DataTableProps<TData>) {
  const {
    label,
    columns,
    data,
    rowCount,
    getRowId,
    pagination,
    onPaginationChange,
    sorting,
    onSortingChange,
    isLoading = false,
    isFetching = false,
    error,
    onRowOpen,
    density = 'desk',
  } = props;

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: data ?? EMPTY,
    getRowId: (row) => getRowId(row),
    rowCount: rowCount ?? 0,
    state: { pagination, sorting },
    onPaginationChange,
    onSortingChange,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
  });

  const rows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil((rowCount ?? 0) / pagination.pageSize));
  const goToPage = (pageIndex: number) => {
    onPaginationChange({
      ...pagination,
      pageIndex: Math.max(0, Math.min(pageIndex, pageCount - 1)),
    });
  };
  const navigation = useRowNavigation({
    rowCount: rows.length,
    ...(onRowOpen
      ? {
          onOpen: (index: number) => {
            const row = rows[index];
            if (row) onRowOpen(row.original);
          },
        }
      : {}),
    onNextPage: () => {
      goToPage(pagination.pageIndex + 1);
    },
    onPreviousPage: () => {
      goToPage(pagination.pageIndex - 1);
    },
  });
  useTableKeysHelp(onRowOpen !== undefined);

  const visibleColumns = table.getVisibleLeafColumns();
  const colSpan = Math.max(1, visibleColumns.length);
  const searching = (props.search ?? '').trim() !== '';
  const showRows = error === undefined && !isLoading && rows.length > 0;

  let status: ReactNode = null;
  if (error !== undefined && error !== null) {
    status = <ErrorState error={error} {...(props.onRetry ? { onRetry: props.onRetry } : {})} />;
  } else if (isLoading) {
    status = null;
  } else if (rows.length === 0 && searching) {
    status = (
      <EmptyState
        icon={SearchXIcon}
        title={`No ${label.toLowerCase()} match “${props.search?.trim() ?? ''}”`}
        action={
          <Button variant="outline" size="sm" onClick={() => props.onSearchChange?.('')}>
            Clear search
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    status = props.empty ?? <EmptyState title={`No ${label.toLowerCase()} yet`} />;
  }

  return (
    <div className="flex min-h-0 flex-col">
      <DataTableToolbar
        {...(props.onSearchChange
          ? { search: props.search ?? '', onSearchChange: props.onSearchChange }
          : {})}
        searchPlaceholder={props.searchPlaceholder ?? `Search ${label.toLowerCase()}`}
        columns={table
          .getAllLeafColumns()
          .filter((c) => c.getCanHide())
          .map((c) => ({
            id: c.id,
            label: c.columnDef.meta?.label ?? c.id,
            visible: c.getIsVisible(),
            toggle: (visible: boolean) => {
              c.toggleVisibility(visible);
            },
          }))}
      >
        {props.toolbar}
      </DataTableToolbar>
      <div className="rounded-md border bg-card">
        <Table
          density={density}
          aria-label={label}
          aria-busy={isLoading || isFetching}
          aria-rowcount={rowCount === undefined ? undefined : rowCount + 1}
        >
          <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <SortableHead key={header.id} header={header} />
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody
            onKeyDown={navigation.onKeyDown}
            className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity')}
          >
            {isLoading
              ? Array.from({ length: Math.min(SKELETON_ROWS, pagination.pageSize) }, (_, i) => (
                  <TableRow key={`skeleton-${String(i)}`} aria-hidden>
                    {visibleColumns.map((c) => (
                      <TableCell key={c.id}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : null}
            {showRows
              ? rows.map((row, index) => (
                  <TableRow
                    key={row.id}
                    data-row
                    tabIndex={index === navigation.activeIndex ? 0 : -1}
                    aria-rowindex={pagination.pageIndex * pagination.pageSize + index + 2}
                    className={cn(
                      'outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                      onRowOpen && 'cursor-pointer',
                    )}
                    onFocus={() => {
                      navigation.onRowFocus(index);
                    }}
                    onDoubleClick={
                      onRowOpen
                        ? () => {
                            onRowOpen(row.original);
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          cell.column.columnDef.meta?.align === 'right' && 'text-right',
                        )}
                      >
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : null}
            {status === null ? null : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colSpan} className="p-0 whitespace-normal">
                  {status}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {rowCount !== undefined && rowCount > 0 ? (
        <DataTablePagination
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          rowCount={rowCount}
          onPageChange={goToPage}
          onPageSizeChange={(pageSize) => {
            onPaginationChange({ pageIndex: 0, pageSize });
          }}
        />
      ) : null}
    </div>
  );
}

function SortableHead<TData extends RowData>({
  header,
}: {
  header: Header<DataTableFeatures, TData>;
}) {
  const { column } = header;
  const align = column.columnDef.meta?.align;
  const sorted = column.getIsSorted();
  const content = header.isPlaceholder ? null : <FlexRender header={header} />;
  const ariaSort = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined;

  if (!column.getCanSort()) {
    return <TableHead className={cn(align === 'right' && 'text-right')}>{content}</TableHead>;
  }
  const Icon = sorted === 'asc' ? ArrowUpIcon : sorted === 'desc' ? ArrowDownIcon : ArrowUpDownIcon;
  return (
    <TableHead aria-sort={ariaSort} className={cn(align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={column.getToggleSortingHandler()}
        className={cn(
          '-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {content}
        <Icon aria-hidden className={cn('size-3.5', sorted === false && 'opacity-40')} />
      </button>
    </TableHead>
  );
}

/** Lists the table's element-scoped keys in the `?` help while a table is on screen. */
function useTableKeysHelp(canOpen: boolean): void {
  const group = 'Tables';
  useHotkey({
    id: 'table.rows',
    keys: 'arrowup,arrowdown',
    description: 'Move between rows',
    group,
  });
  useHotkey({
    id: 'table.open',
    keys: 'enter',
    description: 'Open the row',
    group,
    enabled: canOpen,
  });
  useHotkey({
    id: 'table.pages',
    keys: 'pageup,pagedown',
    description: 'Previous / next page',
    group,
  });
}
