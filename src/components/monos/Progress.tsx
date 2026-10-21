'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ProgressTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success';

export type ProgressProps = {
  /** 0..100; если значения нет — полоса «без определения». */
  value?: number;
  tone?: ProgressTone;
  /** Доступное имя полосы. */
  label?: string;
  /** Показывать процент рядом с полосой. */
  showValue?: boolean;
  /** Высота полосы. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const TONES: Record<ProgressTone, string> = {
  neutral: 'bg-ink-muted',
  accent: 'bg-accent',
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
};

const SIZES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2',
};

/**
 * Стили набора приходят в Svelte как scoped-CSS, а React их не умеет. Поэтому
 * эти же правила едут вместе с компонентом: страница не должна зависеть от
 * того, подключён ли где-то ещё css набора. React 19 собирает такой блок один
 * раз по `href` и кладёт в `<head>`.
 */
const PROGRESS_CSS = `
.ui-progress-fill {
  transition: width 200ms ease;
}
.ui-progress-indeterminate {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 35%;
  border-radius: var(--ui-radius);
  animation: ui-progress 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.ui-progress-delay {
  animation-delay: -0.8s;
}
@keyframes ui-progress {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(330%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-progress-fill {
    transition: none;
  }
  .ui-progress-indeterminate {
    width: 100%;
    animation: none;
    opacity: 0.35;
  }
  .ui-progress-delay {
    display: none;
  }
}
`;

/**
 * Полоса прогресса. Без значения она «без определения»: приложение не знает
 * доли заранее, но показывает, что работа идёт.
 */
export function Progress({
  value,
  tone = 'accent',
  label,
  showValue = false,
  size = 'md',
  className,
}: ProgressProps) {
  const indeterminate = value === undefined;
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  const percent = clamped;

  const bar = (
    <div
      role="progressbar"
      aria-label={label || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      className={cn(
        'relative w-full overflow-hidden rounded-ui bg-surface-2',
        SIZES[size] || SIZES.md,
        showValue ? 'min-w-0 flex-1' : '',
        className,
      )}
    >
      {indeterminate ? (
        <>
          <span className={cn('ui-progress-indeterminate', TONES[tone] || TONES.accent)} />
          <span
            className={cn(
              'ui-progress-indeterminate ui-progress-delay',
              TONES[tone] || TONES.accent,
            )}
          />
        </>
      ) : (
        <span
          className={cn('block h-full rounded-ui', TONES[tone] || TONES.accent, 'ui-progress-fill')}
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );

  return (
    <>
      <style href="monos-progress" precedence="monos">
        {PROGRESS_CSS}
      </style>
      {showValue ? (
        <div className="flex items-center gap-2">
          {bar}
          {!indeterminate ? (
            <span className="shrink-0 text-xs text-ink-faint tabular-nums">
              {Math.round(percent)}%
            </span>
          ) : null}
        </div>
      ) : (
        bar
      )}
    </>
  );
}
