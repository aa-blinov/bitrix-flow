'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { FieldSize, FieldVariant } from './TextField';

let counter = 0;

/** Многострочное поле с тем же ритмом подписи, подсказки и ошибки, что у TextField. */
export type TextAreaProps = React.ComponentProps<'textarea'> & {
  label?: string;
  hint?: string;
  error?: string;
  variant?: FieldVariant;
  size?: FieldSize;
  className?: string;
};

export function TextArea({
  label,
  hint,
  error,
  variant = 'underline',
  size = 'md',
  className,
  id,
  rows = 4,
  ...props
}: TextAreaProps) {
  const fallbackId = React.useMemo(() => `ui-textarea-${++counter}`, []);
  const fieldId = id || fallbackId;
  const describedBy =
    [hint ? `${fieldId}-hint` : '', error ? `${fieldId}-error` : ''].filter(Boolean).join(' ') ||
    undefined;

  const shape =
    variant === 'boxed'
      ? `rounded-ui border bg-surface px-3 py-2 ${
          error ? 'border-danger focus:border-danger' : 'border-line focus:border-ink-soft'
        }`
      : `border-b bg-transparent px-1 py-2 ${
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
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full resize-y text-ink outline-none transition-colors duration-fast placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'text-xs' : 'text-sm',
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
