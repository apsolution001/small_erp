import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import { formatMoney } from '@/lib/format';
import { HotkeyRegistry, HotkeysProvider } from '@/lib/hotkeys';
import { DataTable, type DataTableProps } from './data-table';
import { dataTableColumns } from './features';
import { type ListQuery, useDataTableState } from './use-data-table-state';

interface Party {
  id: string;
  name: string;
  balance: string;
}

const col = dataTableColumns<Party>();
const columns = col.columns([
  col.accessor('name', { header: 'Name', meta: { label: 'Name' } }),
  col.accessor('balance', {
    header: 'Balance',
    meta: { label: 'Balance', align: 'right' },
    enableSorting: false,
    cell: (info) => formatMoney(info.getValue()),
  }),
]);

const PARTIES: Party[] = [
  { id: 'p1', name: 'Mehta Traders', balance: '1250000' },
  { id: 'p2', name: 'Shah Industries', balance: '-50' },
  { id: 'p3', name: 'Patel & Sons', balance: '0' },
];

type Overrides = Partial<Omit<DataTableProps<Party>, 'columns'>>;

function Harness({
  overrides,
  onQuery,
}: {
  overrides: Overrides;
  onQuery: (q: ListQuery) => void;
}) {
  const state = useDataTableState();
  onQuery(state.query);
  return (
    <DataTable<Party>
      label="Parties"
      columns={columns}
      data={PARTIES}
      rowCount={60}
      getRowId={(p) => p.id}
      {...state}
      {...overrides}
    />
  );
}

function setup(overrides: Overrides = {}) {
  const queries: ListQuery[] = [];
  const wrap = (node: ReactNode) => (
    <HotkeysProvider registry={new HotkeyRegistry(false)}>{node}</HotkeysProvider>
  );
  render(wrap(<Harness overrides={overrides} onQuery={(q) => queries.push(q)} />));
  return { user: userEvent.setup(), lastQuery: () => queries.at(-1) };
}

describe('DataTable', () => {
  it('renders rows with formatted, right-aligned amounts', () => {
    setup();
    const table = screen.getByRole('table', { name: 'Parties' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    const firstCells = within(rows[1]!).getAllByRole('cell');
    expect(firstCells.map((c) => c.textContent)).toEqual(['Mehta Traders', '₹12,500.00']);
    expect(firstCells[1]).toHaveClass('text-right');
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument();
  });

  it('asks the server for the next page and for a sort (back to page 1)', async () => {
    const { user, lastQuery } = setup();
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25 });

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(lastQuery()).toEqual({ page: 2, pageSize: 25 });

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25, sort: 'name:asc' });
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25, sort: 'name:desc' });
  });

  it('debounces the search into the query', async () => {
    const { user, lastQuery } = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search parties' }), ' mehta ');
    await vi.waitFor(() => {
      expect(lastQuery()).toEqual({ page: 1, pageSize: 25, q: 'mehta' });
    });
  });

  it('moves between rows with the arrow keys and opens one with Enter', async () => {
    const onRowOpen = vi.fn();
    const { user } = setup({ onRowOpen });
    const rows = screen.getAllByRole('row').slice(1);

    await user.tab(); // search box
    await user.tab(); // columns menu
    await user.tab(); // sortable Name header
    await user.tab(); // first row (roving tabindex)
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(rows[2]).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onRowOpen).toHaveBeenCalledWith(PARTIES[1]);
  });

  it('hides a column from the column menu', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Balance' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('columnheader', { name: 'Balance' })).not.toBeInTheDocument();
  });

  it('shows skeleton rows and aria-busy while loading', () => {
    setup({ data: undefined, rowCount: undefined, isLoading: true });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('cell', { name: 'Mehta Traders' })).not.toBeInTheDocument();
  });

  it('shows the empty state when there is nothing yet', () => {
    setup({ data: [], rowCount: 0, empty: <p>No parties yet. Add your first customer.</p> });
    expect(screen.getByText('No parties yet. Add your first customer.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('says when a search matches nothing, with a way to clear it', async () => {
    const onSearchChange = vi.fn();
    const { user } = setup({ data: [], rowCount: 0, search: 'zzz', onSearchChange });
    expect(screen.getByText('No parties match “zzz”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('shows a load error with the server message and a retry', async () => {
    const onRetry = vi.fn();
    const error = new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Down.' });
    const { user } = setup({ data: undefined, rowCount: undefined, error, onRetry });
    expect(screen.getByRole('alert')).toHaveTextContent('Down.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
