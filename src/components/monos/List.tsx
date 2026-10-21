'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ListItem = {
  id?: string | number;
  title?: string;
  description?: string;
  meta?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Строка становится кнопкой: без этого клик есть только мышью. */
  onSelect?: () => void;
};

export type ListProps = {
  items: ListItem[];
  emptyLabel?: string;
  /** Разделители между строками. */
  divided?: boolean;
  /** Плотные строки. */
  compact?: boolean;
  className?: string;
};

/**
 * Тихий список. Строка с `onSelect` рисуется кнопкой: кликабельный `<div>`
 * недоступен с клавиатуры, а набор держит клавиатуру рабочей.
 */
export function List({
  items,
  emptyLabel = 'No items',
  divided = true,
  compact = false,
  className,
}: ListProps) {
  const padding = compact ? 'py-1.5' : 'py-2.5';

  return (
    <ul className={cn(divided ? 'divide-y divide-line border-y border-line' : '', className)}>
      {items.length === 0 ? (
        <li>
          <div className={cn('flex min-h-9 items-start gap-3 px-3 max-sm:min-h-11', padding)}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink-faint">{emptyLabel}</span>
            </span>
          </div>
        </li>
      ) : (
        items.map((item, index) => {
          const rowClass = cn(
            'flex min-h-9 items-start gap-3 px-3 max-sm:min-h-11',
            padding,
            item.onSelect
              ? 'w-full text-left transition-colors duration-fast hover:bg-surface'
              : '',
          );
          const content = (
            <>
              {item.icon}
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink">{item.title}</span>
                {item.description ? (
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">
                    {item.description}
                  </span>
                ) : null}
              </span>
              {item.meta ? (
                <span className="shrink-0 text-xs text-ink-faint">{item.meta}</span>
              ) : null}
              {item.trailing}
            </>
          );

          return (
            <li key={item.id ?? item.title ?? index}>
              {item.onSelect ? (
                <button type="button" className={rowClass} onClick={item.onSelect}>
                  {content}
                </button>
              ) : (
                <div className={rowClass}>{content}</div>
              )}
            </li>
          );
        })
      )}
    </ul>
  );
}
