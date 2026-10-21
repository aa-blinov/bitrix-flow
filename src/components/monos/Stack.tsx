import * as React from 'react';
import { cn } from '@/lib/utils';

/** Шкала отступов набора: имя шага вместо пикселей. */
export type StackGap =
  'hair' | 'tight' | 'field' | 'snug' | 'input' | 'base' | 'comfortable' | 'roomy' | 'section';

export type StackProps = {
  direction?: 'row' | 'column';
  gap?: StackGap;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const GAPS: Record<StackGap, string> = {
  hair: 'gap-hair',
  tight: 'gap-tight',
  field: 'gap-field',
  snug: 'gap-snug',
  input: 'gap-input',
  base: 'gap-base',
  comfortable: 'gap-comfortable',
  roomy: 'gap-roomy',
  section: 'gap-section',
};

const ALIGNS: Record<NonNullable<StackProps['align']>, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
};

const JUSTIFIES: Record<NonNullable<StackProps['justify']>, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
};

/**
 * Одноосевая раскладка. `direction="row"` — тот же компонент с другой осью,
 * а промежуток берётся из шкалы отступов, а не из пикселей.
 */
export function Stack({
  direction = 'column',
  gap = 'base',
  align = 'stretch',
  justify = 'start',
  wrap = false,
  className,
  children,
}: StackProps) {
  return (
    <div
      className={cn(
        'flex',
        direction === 'row' ? 'flex-row' : 'flex-col',
        GAPS[gap],
        ALIGNS[align],
        JUSTIFIES[justify],
        wrap ? 'flex-wrap' : 'flex-nowrap',
        className,
      )}
    >
      {children}
    </div>
  );
}
