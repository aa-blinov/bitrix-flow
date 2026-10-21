import * as React from 'react';
import { cn } from '@/lib/utils';

export type Crumb = { label: string; href?: string };

export type BreadcrumbsProps = {
  items: Crumb[];
  /** Разделитель между крошками. */
  separator?: string;
  /** Подпись навигации для скринридера. */
  label?: string;
  className?: string;
};

/**
 * Путь вверх по дереву. Последняя крошка — текущая страница, ссылкой она не
 * является; разделители — декоративный текст, а не точка.
 */
export function Breadcrumbs({
  items,
  separator = '/',
  label = 'Breadcrumb',
  className,
}: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <span className="text-ink-muted" aria-hidden="true">
                  {separator}
                </span>
              ) : null}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="min-w-0 truncate rounded-ui px-0.5 transition-colors duration-fast hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn('min-w-0 truncate', isLast ? 'text-ink' : '')}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
