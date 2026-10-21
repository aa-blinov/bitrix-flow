'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type TabItem = {
  id: string;
  label: string;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  /** Выбранная вкладка. Если не задана, компонент выбирает первую доступную сам. */
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  variant?: 'line' | 'pill';
  /** Содержимое панели; получает id активной вкладки. */
  panel?: (active: string) => React.ReactNode;
  className?: string;
};

let counter = 0;

/**
 * Список вкладок по WAI-ARIA: в порядке табуляции только активная вкладка,
 * стрелки и Home/End переключают. Панель рисуется, когда передан `panel`.
 */
export function Tabs({
  items,
  value,
  onChange,
  label = '',
  variant = 'line',
  panel,
  className,
}: TabsProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState('');
  const baseId = React.useMemo(() => `ui-tabs-${++counter}`, []);
  const panelId = `${baseId}-panel`;
  const listEl = React.useRef<HTMLDivElement | null>(null);
  const focusPending = React.useRef(false);

  const enabled = React.useMemo(() => items.filter((item) => !item.disabled), [items]);

  const requested = controlled ? value : internal;
  // Запрошенной вкладки может не оказаться: тогда берём первую доступную,
  // как это делал набор.
  const active = enabled.some((item) => item.id === requested) ? requested : (enabled[0]?.id ?? '');

  const select = React.useCallback(
    (item: TabItem) => {
      if (item.disabled || item.id === active) return;
      if (!controlled) setInternal(item.id);
      onChange?.(item.id);
    },
    [active, controlled, onChange],
  );

  // После переключения с клавиатуры фокус должен остаться на активной вкладке.
  React.useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    listEl.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus();
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, item: TabItem) => {
    const position = enabled.findIndex((entry) => entry.id === item.id);
    let next = position;
    if (event.key === 'ArrowRight') next = position + 1;
    else if (event.key === 'ArrowLeft') next = position - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    if (!enabled.length) return;
    const wrapped = (next + enabled.length) % enabled.length;
    const target = enabled[wrapped];
    if (!target) return;
    focusPending.current = true;
    select(target);
  };

  const tabClass = (item: TabItem) => {
    const base =
      'inline-flex items-center whitespace-nowrap text-xs uppercase tracking-widest max-sm:min-h-11 transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-30';
    if (variant === 'pill') {
      return cn(
        'min-h-7 rounded-ui px-3',
        base,
        active === item.id ? 'bg-canvas text-ink shadow-rest' : 'text-ink-soft hover:text-ink',
      );
    }
    return cn(
      'relative px-0.5 pb-2 pt-1',
      base,
      active === item.id ? 'font-bold text-ink' : 'text-ink-faint hover:text-ink',
    );
  };

  return (
    <div className={className}>
      <div
        ref={listEl}
        role="tablist"
        aria-label={label || undefined}
        className={
          variant === 'pill'
            ? 'inline-flex max-w-full overflow-x-auto overflow-y-hidden rounded-ui border border-line bg-surface p-0.5'
            : 'flex max-w-full gap-6 overflow-x-auto overflow-y-hidden border-b border-line'
        }
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${item.id}`}
            aria-selected={active === item.id}
            aria-controls={panel ? panelId : undefined}
            tabIndex={active === item.id ? 0 : -1}
            disabled={item.disabled}
            className={tabClass(item)}
            onClick={() => select(item)}
            onKeyDown={(event) => onKeyDown(event, item)}
          >
            {item.label}
            {variant !== 'pill' && active === item.id ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>

      {panel ? (
        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={`${baseId}-tab-${active}`}
          tabIndex={0}
          className="mt-4 outline-none"
        >
          {panel(active)}
        </div>
      ) : null}
    </div>
  );
}
