'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Tone } from './Badge';
import { t } from '@/lib/i18n';

/** Небольшая метка, а не фильтр. Тон меняет только текст, форма остаётся тихой. */
const TONES: Record<Tone, string> = {
  neutral: 'text-ink-soft',
  accent: 'text-accent-text',
  danger: 'text-danger-text',
  warning: 'text-warning-text',
  success: 'text-success-text',
};

const SIZES = {
  sm: 'px-2 py-0.5 text-whisper',
  md: 'px-2.5 py-1 text-xs',
};

export type ChipProps = React.ComponentProps<'span'> & {
  tone?: Tone;
  size?: 'sm' | 'md';
  /** Показывает крестик и сообщает о нём через `onRemove`. */
  removable?: boolean;
  removeLabel?: string;
  onRemove?: () => void;
};

export function Chip({
  className,
  tone = 'neutral',
  size = 'sm',
  removable = false,
  removeLabel = t('Убрать'),
  onRemove,
  children,
  ...props
}: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-ui border border-line bg-canvas',
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {removable ? (
        <button
          type="button"
          aria-label={removeLabel}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-ui text-current transition-opacity duration-fast hover:opacity-60 max-sm:h-6 max-sm:w-6"
          onClick={onRemove}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m6 6 12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </span>
  );
}
