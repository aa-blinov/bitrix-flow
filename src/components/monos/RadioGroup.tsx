'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type RadioOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Пояснение под подписью. */
  description?: string;
};

export type RadioGroupProps = {
  name: string;
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  /** Раскладка вариантов. */
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  className?: string;
};

/**
 * Один выбор из нескольких. Это настоящая группа радиокнопок: имя общее,
 * стрелки двигают выбор так же, как в браузере, а круглый круг — потому что
 * радиокнопка круглая по природе.
 */
export function RadioGroup({
  name,
  options,
  value,
  onChange,
  label,
  orientation = 'vertical',
  disabled = false,
  className,
}: RadioGroupProps) {
  const [internal, setInternal] = React.useState('');
  const controlled = value !== undefined;
  const current = controlled ? value : internal;

  const choose = (option: RadioOption) => {
    if (disabled || option.disabled) return;
    if (!controlled) setInternal(option.value);
    onChange?.(option.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label || undefined}
      className={cn(
        'flex',
        orientation === 'horizontal' ? 'flex-wrap gap-x-5 gap-y-2' : 'flex-col gap-2',
        className,
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'group flex min-h-6 items-start gap-2.5 max-sm:min-h-11',
            disabled || option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={current === option.value}
              disabled={disabled || option.disabled}
              onChange={() => choose(option)}
              className="peer absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-full border border-line bg-canvas transition-colors duration-fast checked:border-ink checked:bg-ink disabled:cursor-not-allowed"
            />
            <span className="pointer-events-none absolute inset-0 m-auto h-1.5 w-1.5 rounded-full bg-canvas opacity-0 peer-checked:opacity-100" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-ink-soft transition-colors duration-fast group-hover:text-ink">
              {option.label ?? option.value}
            </span>
            {option.description ? (
              <span className="mt-0.5 block text-whisper text-ink-faint">{option.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}
