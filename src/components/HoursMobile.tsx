'use client';

// Телефонный вид аналитики часов. Таблица на узком экране уводила часы за правый край:
// раскрытые строки выглядели пустыми, пока не прокрутишь вбок. Здесь число всегда
// стоит справа в той же строке, что и подпись, а вложенность видна отступом.
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type MobilePivotRow = {
  projectId: string;
  project: string;
  total: number;
  plan: number;
  variance?: number;
  classes: { key: string; label: string; hours: number }[];
};

const signed = (value: number, fmt: (v: number) => string) =>
  `${value > 0 ? '+' : ''}${fmt(value)}`;

const chip =
  'inline-flex min-h-11 items-center gap-1.5 rounded-ui border border-line px-2.5 text-xs text-ink-soft hover:border-line-strong hover:text-ink';

export function PivotCards({
  rows,
  totals,
  showPlan,
  fmt,
  onProject,
  onCell,
  onClassTotal,
  emptyLabel,
}: {
  rows: MobilePivotRow[];
  totals: MobilePivotRow;
  showPlan: boolean;
  fmt: (value: number) => string;
  onProject: (projectId: string) => void;
  onCell: (projectId: string, classKey: string) => void;
  onClassTotal: (classKey: string) => void;
  emptyLabel: string;
}) {
  if (!rows.length) return <p className="py-8 text-center text-xs text-ink-faint">{emptyLabel}</p>;
  const card = (row: MobilePivotRow, isTotal: boolean) => (
    <li
      key={isTotal ? '__total__' : row.projectId}
      aria-label={row.project}
      className={cn(
        'rounded-ui border bg-surface p-3',
        isTotal ? 'border-line-strong' : 'border-line',
      )}
    >
      {isTotal ? (
        <div className="flex items-baseline justify-between gap-3 font-semibold text-ink">
          <span>{row.project}</span>
          <span className="tabular-nums">{fmt(row.total)}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onProject(row.projectId)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-medium text-ink hover:underline"
        >
          <span className="min-w-0 break-words">{row.project}</span>
          <span className="tabular-nums font-semibold">{fmt(row.total)}</span>
        </button>
      )}
      {showPlan && row.plan > 0 ? (
        <p className="mt-0.5 text-xs text-ink-soft tabular-nums">
          {t('План')} {fmt(row.plan)}
          {row.variance !== undefined ? (
            <>
              {' · '}
              {t('Отклонение')}{' '}
              <span className={row.variance > 0 ? 'text-danger-text' : ''}>
                {signed(row.variance, fmt)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      {row.classes.some((cls) => cls.hours) ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.classes
            .filter((cls) => cls.hours)
            .map((cls) => (
              <button
                key={cls.key}
                type="button"
                className={chip}
                onClick={() => (isTotal ? onClassTotal(cls.key) : onCell(row.projectId, cls.key))}
              >
                {cls.label}
                <span className="font-semibold tabular-nums text-ink">{fmt(cls.hours)}</span>
              </button>
            ))}
        </div>
      ) : null}
    </li>
  );
  return (
    <ul aria-label={t('Проекты по классам')} className="space-y-2">
      {rows.map((row) => card(row, false))}
      {card(totals, true)}
    </ul>
  );
}

export type MobileDetailRow = {
  taskId: string;
  task: string;
  hours: number;
  conflict: boolean;
  fields: Record<string, string>;
};

type Group = {
  key: string;
  label: string;
  hours: number;
  groups: Group[];
  rows: MobileDetailRow[];
};

function buildGroups(rows: MobileDetailRow[], levels: string[], prefix = ''): Group[] {
  const [level, ...rest] = levels;
  const byLabel = new Map<string, MobileDetailRow[]>();
  for (const row of rows) {
    const label = row.fields[level];
    byLabel.set(label, [...(byLabel.get(label) || []), row]);
  }
  return [...byLabel]
    .map(([label, items]) => {
      const key = `${prefix}${level}:${label}|`;
      return {
        key,
        label,
        hours: items.reduce((sum, row) => sum + row.hours, 0),
        groups: rest.length ? buildGroups(items, rest, key) : [],
        rows: rest.length ? [] : [...items].sort((a, b) => b.hours - a.hours),
      };
    })
    .sort((a, b) => b.hours - a.hours);
}

const allKeys = (groups: Group[]): string[] =>
  groups.flatMap((group) => [group.key, ...allKeys(group.groups)]);

export function DetailTree({
  rows,
  levels,
  leafFields,
  expandAll,
  fmt,
  emptyLabel,
}: {
  rows: MobileDetailRow[];
  /** Поля группировки сверху вниз, те же, что у таблицы. */
  levels: string[];
  /** Что показать в строке задачи: поля, которые не стали группами. */
  leafFields: string[];
  expandAll: boolean;
  fmt: (value: number) => string;
  emptyLabel: string;
}) {
  const groups = buildGroups(rows, levels);
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandAll ? allKeys(groups) : []));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!rows.length) return <p className="py-8 text-center text-xs text-ink-faint">{emptyLabel}</p>;

  const renderGroup = (group: Group, depth: number) => {
    const isOpen = open.has(group.key);
    return (
      <li key={group.key}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => toggle(group.key)}
          className={cn(
            'flex min-h-11 w-full items-center gap-1.5 border-b border-line px-3 text-left',
            depth === 0 ? 'bg-surface font-medium text-ink' : 'text-ink',
          )}
          style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
        >
          <ChevronRight
            aria-hidden="true"
            strokeWidth={1.7}
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform duration-fast',
              isOpen ? 'rotate-90' : '',
            )}
          />
          <span className="min-w-0 flex-1 break-words">{group.label}</span>
          <span className="shrink-0 tabular-nums">{fmt(group.hours)}</span>
        </button>
        {isOpen ? (
          <ul>
            {group.groups.map((child) => renderGroup(child, depth + 1))}
            {group.rows.map((row, index) => (
              <li key={`${group.key}${row.taskId}:${index}`}>
                <Link
                  href={`/all-tasks?task=${row.taskId}`}
                  title={row.conflict ? t('На задаче два разных классовых тега') : undefined}
                  className="flex min-h-11 items-center gap-3 border-b border-line py-1.5 pr-3 text-ink-soft hover:bg-surface hover:text-ink"
                  style={{ paddingLeft: `${0.75 + (depth + 1) * 1 + 1}rem` }}
                >
                  <span className="min-w-0 flex-1">
                    {levels.includes('task') ? null : (
                      <span className="block break-words text-ink">
                        {row.conflict ? '! ' : ''}
                        {row.task}
                      </span>
                    )}
                    <span className="block text-xs text-ink-faint">
                      {leafFields.map((field) => row.fields[field]).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{fmt(row.hours)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <ul
      aria-label={t('Детализация часов')}
      className="overflow-hidden rounded-ui border border-line text-sm [&>li:last-child>button]:border-b-0"
    >
      {groups.map((group) => renderGroup(group, 0))}
    </ul>
  );
}
