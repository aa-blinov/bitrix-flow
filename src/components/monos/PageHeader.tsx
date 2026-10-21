import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Заголовок страницы: название, предложение и действия справа. Уровень
 * заголовка — свойство, потому что заголовок страницы не всегда первый.
 */
export type PageHeaderProps = {
  title?: string;
  description?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title = '',
  description = '',
  level = 1,
  actions,
  className,
}: PageHeaderProps) {
  const Heading = `h${Math.min(6, Math.max(1, Number(level) || 1))}` as 'h1';

  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-xl font-bold tracking-tight text-ink">{title}</Heading>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
