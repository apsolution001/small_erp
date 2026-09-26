import { type KeyboardEvent, useState } from 'react';

export interface RowNavigation {
  /** The row that takes Tab focus (roving tabindex); -1 when there are no rows. */
  activeIndex: number;
  /** For the table body. */
  onKeyDown: (event: KeyboardEvent<HTMLTableSectionElement>) => void;
  onRowFocus: (index: number) => void;
}

export interface RowNavigationOptions {
  rowCount: number;
  onOpen?: (index: number) => void;
  onNextPage?: () => void;
  onPreviousPage?: () => void;
}

/**
 * Keyboard row navigation for a table body: ↑/↓ move, Home/End jump, Enter opens the row,
 * PgDn/PgUp change page. Rows use a roving tabindex, so Tab enters the table once. Rows are
 * the body's `tr[data-row]` elements.
 */
export function useRowNavigation({
  rowCount,
  onOpen,
  onNextPage,
  onPreviousPage,
}: RowNavigationOptions): RowNavigation {
  const [active, setActive] = useState(0);
  const activeIndex = rowCount === 0 ? -1 : Math.min(active, rowCount - 1);

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (rowCount === 0 || !(event.target instanceof HTMLTableRowElement)) return;
    const body = event.currentTarget;
    const focusRow = (index: number) => {
      const clamped = Math.max(0, Math.min(index, rowCount - 1));
      setActive(clamped);
      body.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[clamped]?.focus();
    };
    const actions: Record<string, (() => void) | undefined> = {
      ArrowDown: () => {
        focusRow(activeIndex + 1);
      },
      ArrowUp: () => {
        focusRow(activeIndex - 1);
      },
      Home: () => {
        focusRow(0);
      },
      End: () => {
        focusRow(rowCount - 1);
      },
      Enter:
        onOpen &&
        (() => {
          onOpen(activeIndex);
        }),
      PageDown: onNextPage,
      PageUp: onPreviousPage,
    };
    const action = actions[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  return { activeIndex, onKeyDown, onRowFocus: setActive };
}
