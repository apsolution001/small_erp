import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PAGE_SIZES = [25, 50, 100, 200] as const;
const indian = new Intl.NumberFormat('en-IN');

export interface DataTablePaginationProps {
  pageIndex: number;
  pageSize: number;
  rowCount: number;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function DataTablePagination({
  pageIndex,
  pageSize,
  rowCount,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const first = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min(rowCount, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
      <p aria-live="polite">
        {rowCount === 0
          ? 'No records'
          : `${indian.format(first)}–${indian.format(last)} of ${indian.format(rowCount)}`}
      </p>
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">Rows per page</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            onPageSizeChange(Number(v));
          }}
        >
          <SelectTrigger size="sm" aria-label="Rows per page" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="px-2 tabular-nums">
          Page {pageIndex + 1} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={pageIndex === 0}
          onClick={() => {
            onPageChange(pageIndex - 1);
          }}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={pageIndex + 1 >= pageCount}
          onClick={() => {
            onPageChange(pageIndex + 1);
          }}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}
