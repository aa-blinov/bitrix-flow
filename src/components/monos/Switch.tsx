'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SwitchProps = {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** Подпись переключателя. */
  children?: React.ReactNode;
};

/**
 * Переключатель: управляет вся строка, подпись — её доступное имя.
 */
export function Switch({ checked, onChange, disabled = false, className, children }: SwitchProps) {
  const [internal, setInternal] = React.useState(false);
  const controlled = checked !== undefined;
  const value = controlled ? checked : internal;

  const toggle = () => {
    if (disabled) return;
    const next = !value;
    if (!controlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        'group inline-flex min-h-6 items-center gap-2.5 text-left max-sm:min-h-11',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-ui border border-line transition-colors duration-fast',
          value ? 'border-ink bg-ink' : 'bg-surface-2',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-ui bg-canvas shadow-rest transition-transform duration-fast',
            value ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
      <span className="text-xs text-ink-soft transition-colors duration-fast group-hover:text-ink">
        {children}
      </span>
    </button>
  );
}
