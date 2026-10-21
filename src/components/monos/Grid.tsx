import * as React from 'react';
import { cn } from '@/lib/utils';
import type { StackGap } from './Stack';

export type GridProps = {
  /** Ровное число колонок. */
  columns?: number;
  /** Ширина минимальной колонки: '16rem' — число колонок следует за местом. */
  min?: string;
  gap?: StackGap;
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

const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
  9: 'grid-cols-9',
  10: 'grid-cols-10',
  11: 'grid-cols-11',
  12: 'grid-cols-12',
};

/**
 * Сетка. С `columns` треки равные, с `min` — auto-fit: число колонок следует за
 * шириной, а не за контрольной точкой.
 */
export function Grid({ columns = 2, min, gap = 'base', className, children }: GridProps) {
  return (
    <div
      className={cn('grid', min ? '' : (COLUMNS[columns] ?? COLUMNS[2]), GAPS[gap], className)}
      style={min ? { gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))` } : undefined}
    >
      {children}
    </div>
  );
}
