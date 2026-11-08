'use client';

// Таблица аналитики на TanStack Table: группировка, суммы по группам и сортировка
// без собственной реализации. @tanstack/react-table взят потому, что он headless:
// разметку и цвета даём мы, поэтому палитра, обе темы и t() работают как везде,
// а у AG Grid группировка только в платной версии и тема своя.
import { ChevronRight, ChevronUp } from 'lucide-react';
import {
  aggregationFn_sum,
  columnGroupingFeature,
  createExpandedRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  rowAggregationFeature,
  rowExpandingFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ExpandedState,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  columnGroupingFeature,
  groupedRowModel: createGroupedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowAggregationFeature,
  aggregationFns: { sum: aggregationFn_sum },
});

export type DataTableFeatures = typeof dataTableFeatures;

type Props<T extends RowData> = {
  columns: ColumnDef<DataTableFeatures, T, any>[];
  data: T[];
  grouping?: string[];
  initialSorting?: SortingState;
  emptyLabel: string;
  caption: string;
  /** Колонки, которые прижимаются вправо: числа читаются столбиком. */
  numeric?: string[];
  /** Открыть все группы сразу: при выбранном проекте детализация и есть ответ. */
  expandAll?: boolean;
};

export function DataTable<T extends RowData>({
  columns,
  data,
  grouping = [],
  initialSorting = [],
  emptyLabel,
  caption,
  numeric = [],
  expandAll = false,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [expanded, setExpanded] = useState<ExpandedState>(expandAll ? true : {});

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    state: { sorting, expanded, grouping },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    groupedColumnMode: 'reorder',
    autoResetExpanded: false,
  });

  const align = (id: string) =>
    numeric.includes(id) ? 'whitespace-nowrap text-right tabular-nums' : 'text-left';
  const rows = table.getRowModel().rows;
  const hasFooter = columns.some((column) => column.footer);

  return (
    <div className="w-full overflow-x-auto rounded-ui border border-line">
      <table className="w-full border-collapse text-sm text-ink">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-canvas">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-line">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                    }
                    // Заголовок переносится: «Внутренняя разработка» в одну строку делала
                    // таблицу шире экрана, хотя числа под ним короткие.
                    className={cn(
                      'px-3 py-2 align-bottom text-whisper font-bold uppercase tracking-widest text-ink-faint',
                      align(header.column.id),
                      'whitespace-normal',
                    )}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 font-bold uppercase tracking-widest transition-colors duration-fast hover:text-ink max-sm:min-h-11"
                      >
                        <table.FlexRender header={header} />
                        <ChevronUp
                          aria-hidden="true"
                          strokeWidth={1.7}
                          className={cn(
                            'h-3 w-3 shrink-0',
                            sorted ? 'opacity-100' : 'opacity-30',
                            sorted === 'desc' ? '-rotate-180' : '',
                          )}
                        />
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-xs text-ink-faint">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  'border-b border-line last:border-b-0 hover:bg-surface',
                  row.getIsGrouped() && row.depth === 0 ? 'bg-surface font-medium' : '',
                )}
              >
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn('px-3 py-1.5 text-ink-soft', align(cell.column.id))}
                  >
                    {cell.getIsGrouped() ? (
                      <button
                        type="button"
                        onClick={row.getToggleExpandedHandler()}
                        aria-expanded={row.getIsExpanded()}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-left text-ink max-sm:min-h-11"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          strokeWidth={1.7}
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 transition-transform duration-fast',
                            row.getIsExpanded() ? 'rotate-90' : '',
                          )}
                        />
                        <table.FlexRender cell={cell} />
                        <span className="text-xs text-ink-faint">{row.subRows.length}</span>
                      </button>
                    ) : cell.getIsPlaceholder() ? null : cell.getIsAggregated() ? (
                      // Сумма группы раскрывает ту же группу: по числу кликают чаще, чем по стрелке.
                      <button
                        type="button"
                        onClick={row.getToggleExpandedHandler()}
                        className="whitespace-nowrap hover:text-ink hover:underline"
                      >
                        <table.FlexRender cell={cell} />
                      </button>
                    ) : row.getIsGrouped() ? null : (
                      <table.FlexRender cell={cell} />
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {hasFooter && rows.length > 0 ? (
          <tfoot>
            {table.getFooterGroups().map((group) => (
              <tr key={group.id} className="border-t border-line-strong font-medium text-ink">
                {group.headers.map((header) => (
                  <td key={header.id} className={cn('px-3 py-2', align(header.column.id))}>
                    {header.isPlaceholder ? null : <table.FlexRender footer={header} />}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
