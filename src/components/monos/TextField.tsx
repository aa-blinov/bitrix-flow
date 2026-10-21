'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type FieldVariant = 'underline' | 'boxed';
export type FieldSize = 'sm' | 'md' | 'lg';

const SIZES: Record<FieldSize, string> = {
  sm: 'h-7 text-xs',
  md: 'h-9 text-sm',
  lg: 'h-11 text-sm',
};

let counter = 0;

/**
 * Поле с подписью. `underline` — строка формы, `boxed` — отдельный предмет
 * для поиска. Высота задана ступенью, а не выведена из отступов, поэтому
 * `<input>` и `<select>` стоят на одной базовой линии.
 */
export type TextFieldProps = Omit<React.ComponentProps<'input'>, 'size'> & {
  label?: string;
  hint?: string;
  error?: string;
  variant?: FieldVariant;
  size?: FieldSize;
  /** Отступы вокруг всей группы (подпись, поле, подсказка). */
  className?: string;
};

export function TextField({
  label,
  hint,
  error,
  variant = 'underline',
  size = 'md',
  className,
  id,
  ...props
}: TextFieldProps) {
  const fallbackId = React.useMemo(() => `ui-field-${++counter}`, []);
  const fieldId = id || fallbackId;
  const describedBy =
    [hint ? `${fieldId}-hint` : '', error ? `${fieldId}-error` : ''].filter(Boolean).join(' ') ||
    undefined;

  const shape =
    variant === 'boxed'
      ? `rounded-ui border bg-surface px-3 ${
          error ? 'border-danger focus:border-danger' : 'border-line focus:border-ink-soft'
        }`
      : `border-b bg-transparent px-1 ${
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
      <input
        id={fieldId}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full text-ink outline-none transition-colors duration-fast placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-50',
          SIZES[size],
          'max-sm:h-11',
          shape,
        )}
        {...props}
      />
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
