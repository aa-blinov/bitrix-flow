import * as React from 'react';
import { cn } from '@/lib/utils';

/** Тихая заглушка: иконка, заголовок, одно предложение и действия. */
export type EmptyStateProps = {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function EmptyState({ title, description, icon, actions, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center p-8 text-center', className)}>
      {icon ? (
        <div className="mb-3 text-ink-muted" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      {title ? <p className="text-sm font-bold text-ink">{title}</p> : null}
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-soft">{description}</p>
      ) : null}
      {actions ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}
