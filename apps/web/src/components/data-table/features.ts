import {
  type ColumnDef,
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  type RowData,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table';

/** Per-column display hints for the DataTable. */
export interface DataTableColumnMeta {
  /** Plain-text column name, for the column-visibility menu and screen readers. */
  label?: string;
  /** Amounts and quantities are right-aligned. */
  align?: 'left' | 'right';
}

const columnMeta: DataTableColumnMeta = {};

/**
 * The table features every DataTable uses: server-side sorting and pagination, plus column
 * visibility. Row models stay on the server (`manualSorting`, `manualPagination`).
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  columnMeta,
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData>;

/** Column helper bound to the DataTable features: `const col = dataTableColumns<Party>()`. */
export function dataTableColumns<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}
