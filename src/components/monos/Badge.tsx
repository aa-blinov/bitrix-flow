import * as React from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success';

/**
 * Слово-статус: верхний регистр, разрядка, тихий цвет. Цвет здесь — это
 * состояние, а слово — подпись.
 */
const TONES: Record<Tone, string> = {
  neutral: 'text-ink-soft',
  accent: 'text-accent-text',
  danger: 'text-danger-text',
  warning: 'text-warning-text',
  success: 'text-success-text',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-muted',
  accent: 'bg-accent',
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
};

export type BadgeProps = React.ComponentProps<'span'> & {
  tone?: Tone;
  /** Точка перед словом: сигнал остаётся виден даже в мелком кегле. */
  dot?: boolean;
};

export function Badge({
  className,
  tone = 'neutral',
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className={cn('h-2 w-2 shrink-0 rounded-full', DOTS[tone])} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}
