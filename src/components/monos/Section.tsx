import * as React from 'react';
import { cn } from '@/lib/utils';

export type SectionProps = {
  title?: string;
  description?: string;
  /** Уровень заголовка раздела. */
  level?: 2 | 3 | 4 | 5 | 6;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Раздел страницы с вертикальным ритмом. Своей шапки не имеет: заголовок,
 * описание и действия — необязательные, чтобы пустой раздел оставался чистым.
 */
export function Section({
  title,
  description,
  level = 2,
  actions,
  className,
  children,
}: SectionProps) {
  const Heading = `h${Math.min(6, Math.max(2, level))}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  return (
    <section className={cn('py-12', className)}>
      {title || description || actions ? (
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? (
              <Heading className="text-xl font-bold tracking-tight text-ink">{title}</Heading>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
