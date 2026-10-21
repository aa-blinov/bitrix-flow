'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

let counter = 0;

/**
 * Галка с настоящим полем ввода под ней. Сам квадрат 16px, строка 24px
 * (44px на телефоне), подпись приходит через children.
 */
export type CheckboxProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  checked?: boolean;
  indeterminate?: boolean;
  /** Имя для элемента без видимой подписи. */
  ariaLabel?: string;
};

export function Checkbox({
  className,
  checked,
  indeterminate = false,
  disabled = false,
  id,
  ariaLabel,
  children,
  ...props
}: CheckboxProps) {
  const fallbackId = React.useMemo(() => `ui-checkbox-${++counter}`, []);
  const fieldId = id || fallbackId;
  const input = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      htmlFor={fieldId}
      className={cn(
        'group inline-flex min-h-6 select-none items-center gap-2.5 max-sm:min-h-11',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <input
          ref={input}
          id={fieldId}
          type="checkbox"
          aria-label={ariaLabel || undefined}
          checked={checked}
          disabled={disabled}
          className="peer absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-ui border border-line bg-canvas transition-colors duration-fast checked:border-ink checked:bg-ink group-hover:border-line-strong disabled:cursor-not-allowed"
          {...props}
        />
        {indeterminate ? (
          <svg
            className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-canvas"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M6 12h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-canvas opacity-0 peer-checked:opacity-100"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <polyline
              points="20 6 9 17 4 12"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="text-xs text-ink-soft transition-colors duration-fast group-hover:text-ink">
        {children}
      </span>
    </label>
  );
}
