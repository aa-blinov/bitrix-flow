'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { FieldSize, FieldVariant } from './TextField';

export type SelectOption = {
  value: string;
  label?: string;
  disabled?: boolean;
};

let counter = 0;

/**
 * Подписанный нативный select. Список вариантов остаётся системным: его
 * рисует сама система — нужным шрифтом и с нужным поведением клавиатуры, —
 * а набор оформляет только закрытое состояние.
 */
export type SelectFieldProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  label?: string;
  hint?: string;
  error?: string;
  options?: SelectOption[];
  placeholder?: string;
  size?: FieldSize;
  variant?: FieldVariant;
  className?: string;
};

const SIZES: Record<FieldSize, string> = {
  sm: 'h-7 text-xs',
  md: 'h-9 text-sm',
  lg: 'h-11 text-sm',
};

export function SelectField({
  label,
  hint,
  error,
  options = [],
  placeholder,
  size = 'md',
  variant = 'underline',
  className,
  id,
  ...props
}: SelectFieldProps) {
  const fallbackId = React.useMemo(() => `ui-select-${++counter}`, []);
  const fieldId = id || fallbackId;
  const describedBy =
    [hint ? `${fieldId}-hint` : '', error ? `${fieldId}-error` : ''].filter(Boolean).join(' ') ||
    undefined;

  const shape =
    variant === 'boxed'
      ? `rounded-ui border bg-surface pl-3 pr-9 ${
          error ? 'border-danger focus:border-danger' : 'border-line focus:border-ink-soft'
        }`
      : `border-b bg-transparent pl-1 pr-8 ${
          error ? 'border-danger focus:border-danger' : 'border-line focus:border-ink-soft'
        }`;

  return (
    <div className={className}>
      {label ? (
        <label
          htmlFor={fieldId}
          className="mb-1.5 block text-xs uppercase tracking-widest text-ink-soft"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={fieldId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full appearance-none text-ink outline-none transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50',
            SIZES[size],
            'max-sm:h-11',
            shape,
          )}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled={props.required}>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label ?? option.value}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {error ? (
        <p id={`${fieldId}-error`} className="mt-1.5 text-xs text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
