'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AccordionItem = {
  id: string;
  title: string;
  content?: React.ReactNode;
  disabled?: boolean;
};

export type AccordionProps = {
  items: AccordionItem[];
  /** id открытых пунктов; если задан — состояние под управлением вызывающего. */
  open?: string[];
  onOpenChange?: (open: string[]) => void;
  multiple?: boolean;
  /** Подпись группы для скринридера. */
  label?: string;
  /** Уровень заголовка пункта. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  className?: string;
};

/**
 * Стопка раскрывающихся списков. `open` — список открытых id; без `multiple`
 * открыт остаётся только один. Содержимое не вынимается из вёрстки, а прячется,
 * поэтому состояние формы внутри не теряется.
 */
export function Accordion({
  items,
  open,
  onOpenChange,
  multiple = false,
  label,
  headingLevel = 3,
  className,
}: AccordionProps) {
  const [internalOpen, setInternalOpen] = React.useState<string[]>(open ?? []);
  const controlled = open !== undefined;
  const current = controlled ? open : internalOpen;

  const rawId = React.useId();
  const baseId = `ui-accordion-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  const Heading = `h${Math.min(6, Math.max(2, headingLevel))}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  function toggle(item: AccordionItem) {
    if (item.disabled) return;
    const next = current.includes(item.id)
      ? current.filter((id) => id !== item.id)
      : multiple
        ? [...current, item.id]
        : [item.id];
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div
      className={cn('border-y border-line', className)}
      role={label ? 'group' : undefined}
      aria-label={label || undefined}
    >
      {items.map((item) => {
        const isOpen = current.includes(item.id);
        const headId = `${baseId}-head-${item.id}`;
        const panelId = `${baseId}-panel-${item.id}`;

        return (
          <div key={item.id} className="border-b border-line last:border-b-0">
            <Heading>
              <button
                type="button"
                id={headId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                disabled={item.disabled}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-bold text-ink transition-colors duration-fast hover:text-ink-soft disabled:cursor-not-allowed disabled:opacity-30"
                onClick={() => toggle(item)}
              >
                <span className="min-w-0">{item.title}</span>
                <ChevronDown
                  aria-hidden="true"
                  strokeWidth={1.7}
                  className={cn(
                    'h-4 w-4 shrink-0 text-ink-muted transition-transform duration-fast',
                    isOpen ? 'rotate-180' : '',
                  )}
                />
              </button>
            </Heading>
            <div
              id={panelId}
              role="region"
              aria-labelledby={headId}
              hidden={!isOpen}
              className="pb-4 pr-7 text-sm leading-relaxed text-ink-soft"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
