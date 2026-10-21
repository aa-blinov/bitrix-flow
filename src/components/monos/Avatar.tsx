'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type AvatarStatus = 'online' | 'away' | 'busy' | 'offline';

export type AvatarProps = {
  name?: string;
  src?: string;
  /** Подпись картинки; по умолчанию — имя. */
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  status?: AvatarStatus;
  className?: string;
};

const SIZES: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string> = {
  xs: 'h-6 w-6 text-whisper',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-sm',
  xl: 'h-16 w-16 text-base',
};

const STATUS_SIZES: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string> = {
  xs: 'h-1.5 w-1.5 border',
  sm: 'h-2 w-2 border',
  md: 'h-2.5 w-2.5 border-2',
  lg: 'h-2.5 w-2.5 border-2',
  xl: 'h-3 w-3 border-2',
};

const STATUSES: Record<AvatarStatus, string> = {
  online: 'bg-success',
  away: 'bg-warning',
  busy: 'bg-danger',
  offline: 'bg-ink-muted',
};

/**
 * Человек или продукт. С картинкой показывает картинку, без неё — инициалы
 * имени; если картинка не загрузилась, остаются инициалы.
 */
export function Avatar({ name, src, alt, size = 'md', status, className }: AvatarProps) {
  // Храним адрес сорвавшейся картинки, а не флаг: сменился src — и ошибка
  // прежней картинки больше не действует, без лишнего эффекта.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;

  const initials =
    String(name || alt || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';

  const label = alt || name || 'Avatar';

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        SIZES[size] || SIZES.md,
        className,
      )}
    >
      <span className="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2 text-ink-soft">
        {src && !failed ? (
          // next/image здесь не подходит: набор рисует картинку как обычную
          // картинку в круге и при ошибке откатывается к инициалам.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt || name || ''}
            className="h-full w-full object-cover"
            onError={() => setFailedSrc(src)}
          />
        ) : (
          <span
            role="img"
            aria-label={label}
            className="select-none font-bold uppercase tracking-wide"
          >
            {initials}
          </span>
        )}
      </span>
      {status ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-canvas',
            STATUS_SIZES[size] || STATUS_SIZES.md,
            STATUSES[status] || STATUSES.offline,
          )}
        />
      ) : null}
    </span>
  );
}
