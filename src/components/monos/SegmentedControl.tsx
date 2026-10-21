'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SegmentedOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  options: SegmentedOption[];
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
};

const SIZES: Record<'sm' | 'md', string> = {
  sm: 'min-h-7 px-2.5 text-whisper',
  md: 'min-h-8 px-3 text-xs',
};

/**
 * Ряд вариантов, из которых нажат один. Это группа кнопок, а не вкладки:
 * выбор меняет настройку, а не страницу.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  label,
  size = 'md',
  disabled = false,
  className,
}: SegmentedControlProps) {
  const [internal, setInternal] = React.useState('');
  const controlled = value !== undefined;
  const current = controlled ? value : internal;

  const pick = (option: SegmentedOption) => {
    if (disabled || option.disabled || option.value === current) return;
    if (!controlled) setInternal(option.value);
    onChange?.(option.value);
  };

  return (
    <div
      role="group"
      aria-label={label || undefined}
      className={cn('inline-flex rounded-ui border border-line bg-surface p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={current === option.value}
          disabled={disabled || option.disabled}
          onClick={() => pick(option)}
          className={cn(
            'inline-flex items-center justify-center rounded-ui uppercase tracking-widest transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-30 max-sm:min-h-11',
            SIZES[size] || SIZES.md,
            current === option.value
              ? 'bg-canvas text-ink shadow-rest'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {option.label ?? option.value}
        </button>
      ))}
    </div>
  );
}
