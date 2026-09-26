import { Columns3Icon, SearchIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { useHotkey } from '@/lib/hotkeys';

export interface ToggleableColumn {
  id: string;
  label: string;
  visible: boolean;
  toggle: (visible: boolean) => void;
}

export interface DataTableToolbarProps {
  search?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder: string;
  columns: readonly ToggleableColumn[];
  /** Filters and actions shown between the search and the column menu. */
  children?: ReactNode;
}

export function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  columns,
  children,
}: DataTableToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const searchable = onSearchChange !== undefined;
  useHotkey({
    id: 'table.search',
    keys: '/',
    description: 'Search the list',
    group: 'Tables',
    enabled: searchable,
    handler: () => searchRef.current?.focus(),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2">
      {searchable ? (
        <div className="relative w-full max-w-xs">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={search ?? ''}
            className="h-8 pr-8 pl-8"
            onChange={(e) => {
              onSearchChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && (search ?? '') !== '') {
                e.preventDefault();
                onSearchChange('');
              }
            }}
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
        </div>
      ) : null}
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      {columns.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3Icon aria-hidden />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={c.visible}
                onSelect={(e) => {
                  e.preventDefault();
                }}
                onCheckedChange={(checked) => {
                  c.toggle(checked);
                }}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
