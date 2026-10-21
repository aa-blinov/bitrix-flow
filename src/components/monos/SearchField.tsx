'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SearchFieldProps = {
  value?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  /** Доступное имя поля. */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  id?: string;
  className?: string;
  autoFocus?: boolean;
};

const SIZES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8 pl-8 pr-8 text-xs',
  md: 'h-10 pl-10 pr-9 text-sm',
  lg: 'h-11 pl-11 pr-10 text-sm',
};

/**
 * Единственное поле поиска: пилюля, лупа слева, крестик справа. Esc сначала
 * чистит поле, второй Esc доходит до страницы.
 */
export function SearchField({
  value,
  onChange,
  onClear,
  placeholder = 'Поиск',
  label = 'Поиск',
  size = 'md',
  disabled = false,
  id,
  className,
  autoFocus = false,
}: SearchFieldProps) {
  const [internal, setInternal] = React.useState('');
  const controlled = value !== undefined;
  const current = controlled ? value : internal;

  const setValue = (next: string) => {
    if (!controlled) setInternal(next);
    onChange?.(next);
  };

  const clear = () => {
    setValue('');
    onClear?.();
  };

  return (
    <div className={cn('relative', className)}>
      <Search
        strokeWidth={1.7}
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
      />
      <input
        id={id}
        type="search"
        value={current}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && current) {
            event.preventDefault();
            clear();
          }
        }}
        className={cn(
          'w-full rounded-ui border border-line bg-surface text-ink outline-none transition-colors duration-fast placeholder:text-ink-faint focus:border-ink-soft disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-search-cancel-button]:hidden',
          SIZES[size] || SIZES.md,
          'max-sm:h-11',
        )}
      />
      {current ? (
        <button
          type="button"
          aria-label="Очистить"
          onClick={clear}
          className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-ui text-ink-soft transition-colors duration-fast hover:text-ink"
        >
          <X strokeWidth={1.7} aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
