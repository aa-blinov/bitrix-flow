'use client';

import * as React from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from './Checkbox';

export type TableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  /** Значение для сортировки; по умолчанию — row[column.key]. */
  sortValue?: (row: Record<string, unknown>) => unknown;
  /** Свой рисователь ячейки; по умолчанию — String(row[column.key]). */
  cell?: (row: Record<string, unknown>, index: number) => React.ReactNode;
  /** Ширина колонки. */
  width?: string;
};

export type TableSort = { key: string; direction: 'asc' | 'desc' } | null;

export type TableProps = {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  rowKey?: string | ((row: Record<string, unknown>, index: number) => string | number);
  caption?: string;
  density?: 'comfortable' | 'compact';
  selectable?: boolean;
  selected?: (string | number)[];
  onSelectChange?: (selected: (string | number)[]) => void;
  sort?: TableSort;
  onSortChange?: (sort: TableSort) => void;
  manualSort?: boolean;
  stickyHeader?: boolean;
  emptyLabel?: string;
  selectAllLabel?: string;
  /** Подпись галки выбора строки. */
  selectRowLabel?: (row: Record<string, unknown>, index: number) => string;
  className?: string;
};

const ALIGNS: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const PADS: Record<'comfortable' | 'compact', string> = {
  comfortable: 'py-2.5',
  compact: 'py-1.5',
};

/** Выравнивание по умолчанию — левое. */
const alignOf = (align: TableColumn['align']) => (align ? ALIGNS[align] : ALIGNS.left);

/**
 * Таблица данных. Сортировка и выделение живут в состоянии набора, поэтому
 * компонент работает и как управляемый (приходят `sort`/`selected`), и как
 * обычный (состояние внутреннее, наружу уходят `onSortChange`/`onSelectChange`).
 */
export function Table({
  columns,
  rows,
  rowKey = 'id',
  caption,
  density = 'comfortable',
  selectable = false,
  selected,
  onSelectChange,
  sort,
  onSortChange,
  manualSort = false,
  stickyHeader = true,
  emptyLabel = 'No rows',
  selectAllLabel = 'Select all rows',
  selectRowLabel,
  className,
}: TableProps) {
  const [internalSort, setInternalSort] = React.useState<TableSort>(null);
  const [internalSelected, setInternalSelected] = React.useState<(string | number)[]>([]);

  const sortControlled = sort !== undefined;
  const activeSort = sortControlled ? sort : internalSort;
  const selectedControlled = selected !== undefined;
  const activeSelected = selectedControlled ? selected : internalSelected;

  const pads = PADS[density] || PADS.comfortable;

  const keyOf = React.useCallback(
    (row: Record<string, unknown>, index: number): string | number => {
      if (typeof rowKey === 'function') return rowKey(row, index);
      const raw = row[rowKey];
      if (typeof raw === 'string' || typeof raw === 'number') return raw;
      return index;
    },
    [rowKey],
  );

  const sortedRows = React.useMemo(() => {
    if (!activeSort || manualSort) return rows;
    const column = columns.find((item) => item.key === activeSort.key);
    if (!column) return rows;
    const direction = activeSort.direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue ? column.sortValue(a) : a[column.key];
      const right = column.sortValue ? column.sortValue(b) : b[column.key];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * direction;
      }
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
    });
  }, [rows, columns, activeSort, manualSort]);

  const keys = React.useMemo(
    () => sortedRows.map((row, index) => keyOf(row, index)),
    [sortedRows, keyOf],
  );

  const allSelected =
    selectable && keys.length > 0 && keys.every((key) => activeSelected.includes(key));
  const someSelected = selectable && keys.some((key) => activeSelected.includes(key));

  const nextSort = (column: TableColumn) => {
    if (!column.sortable) return;
    let next: TableSort;
    if (activeSort?.key !== column.key) next = { key: column.key, direction: 'asc' };
    else if (activeSort.direction === 'asc') next = { key: column.key, direction: 'desc' };
    else next = null;
    if (!sortControlled) setInternalSort(next);
    onSortChange?.(next);
  };

  const toggleAll = () => {
    const next = allSelected ? [] : keys;
    if (!selectedControlled) setInternalSelected(next);
    onSelectChange?.(next);
  };

  const toggleRow = (row: Record<string, unknown>, index: number) => {
    const key = keyOf(row, index);
    const next = new Set(activeSelected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const list = [...next];
    if (!selectedControlled) setInternalSelected(list);
    onSelectChange?.(list);
  };

  const ariaSort = (column: TableColumn): 'none' | 'ascending' | 'descending' => {
    if (!activeSort || activeSort.key !== column.key) return 'none';
    return activeSort.direction === 'desc' ? 'descending' : 'ascending';
  };

  const rowLabel = (row: Record<string, unknown>, index: number) =>
    selectRowLabel ? selectRowLabel(row, index) : `Select row ${index + 1}`;

  return (
    <div className={cn('w-full overflow-x-auto rounded-ui border border-line', className)}>
      <table className="w-full border-collapse text-left text-sm text-ink">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className={cn(stickyHeader ? 'sticky top-0 z-10' : '', 'bg-canvas')}>
          <tr className="border-b border-line">
            {selectable ? (
              <th scope="col" className={cn('w-10 px-3', pads)}>
                <Checkbox
                  ariaLabel={selectAllLabel}
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={toggleAll}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const isSorted = activeSort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortable ? ariaSort(column) : undefined}
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'px-3',
                    pads,
                    'text-whisper font-bold uppercase tracking-widest text-ink-faint',
                    alignOf(column.align),
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left transition-colors duration-fast hover:text-ink max-sm:min-h-11"
                      onClick={() => nextSort(column)}
                    >
                      {column.label}
                      <ChevronUp
                        strokeWidth={1.7}
                        aria-hidden="true"
                        className={cn(
                          'h-3 w-3 shrink-0',
                          isSorted ? 'opacity-100' : 'opacity-30',
                          isSorted && activeSort?.direction === 'desc' ? '-rotate-180' : '',
                        )}
                      />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-3 py-8 text-center text-xs text-ink-faint"
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            sortedRows.map((row, index) => (
              <tr
                key={keyOf(row, index)}
                className="border-b border-line last:border-b-0 hover:bg-surface"
              >
                {selectable ? (
                  <td className={cn('px-3', pads)}>
                    <Checkbox
                      ariaLabel={rowLabel(row, index)}
                      checked={activeSelected.includes(keyOf(row, index))}
                      onChange={() => toggleRow(row, index)}
                    />
                  </td>
                ) : null}
                {columns.map((column) => {
                  const raw = row[column.key];
                  return (
                    <td
                      key={column.key}
                      className={cn('px-3', pads, alignOf(column.align), 'text-ink-soft')}
                    >
                      {column.cell
                        ? column.cell(row, index)
                        : raw === null || raw === undefined
                          ? ''
                          : String(raw)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
