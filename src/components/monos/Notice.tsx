import * as React from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Record<NoticeTone, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-ink-muted',
};

/** Сообщение внутри страницы: точка, заголовок, предложение и крестик. */
export type NoticeProps = React.ComponentProps<'div'> & {
  tone?: NoticeTone;
  title?: string;
  dismissible?: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
};

export function Notice({
  className,
  tone = 'info',
  title = '',
  dismissible = false,
  dismissLabel = t('Закрыть'),
  onDismiss,
  children,
  ...props
}: NoticeProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-ui border border-line bg-surface p-3 text-sm text-ink',
        className,
      )}
      role={tone === 'danger' ? 'alert' : 'status'}
      {...props}
    >
      <span
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONES[tone])}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-bold">{title}</p> : null}
        <div className={cn('text-xs leading-relaxed text-ink-soft', title && 'mt-0.5')}>
          {children}
        </div>
      </div>
      {dismissible ? (
        <button
          type="button"
          aria-label={dismissLabel}
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-ui text-ink-soft transition-colors duration-fast hover:text-ink max-sm:h-11 max-sm:w-11"
          onClick={onDismiss}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m6 6 12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
