import * as React from 'react';
import { cn } from '@/lib/utils';

export type FieldsetProps = {
  legend?: string;
  hint?: string;
  error?: string;
  /** Группа целиком выключается. */
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Именованная группа полей. Легенда — имя группы, подсказка объясняет её до
 * первого элемента управления. Семантика нативного `fieldset` достаётся
 * бесплатно, поэтому свои роли не выдумываем.
 */
export function Fieldset({
  legend,
  hint,
  error,
  disabled = false,
  className,
  children,
}: FieldsetProps) {
  return (
    <fieldset disabled={disabled} className={cn('m-0 min-w-0 border-0 p-0', className)}>
      {legend ? (
        <legend className="p-0 text-xs font-bold uppercase tracking-widest text-ink">
          {legend}
        </legend>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">{hint}</p>
      ) : null}
      <div className="mt-3 space-y-4">{children}</div>
    </fieldset>
  );
}
