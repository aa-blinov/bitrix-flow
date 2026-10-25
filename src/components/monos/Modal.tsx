'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';
import { t } from '@/lib/i18n';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

let counter = 0;

// Блокировка прокрутки общая: во время перехода могут быть открыты два
// окна, и страница остаётся заблокированной до закрытия последнего.
let locks = 0;
let previousOverflow = '';

function lockScroll() {
  if (typeof document === 'undefined') return;
  if (locks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  locks += 1;
}

function unlockScroll() {
  if (typeof document === 'undefined') return;
  locks = Math.max(0, locks - 1);
  if (locks === 0) document.body.style.overflow = previousOverflow;
}

function focusables(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return [
    ...panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

/**
 * Модальная панель. Называет себя заголовком, держит Tab внутри, закрывается
 * по Escape и по клику в фон и возвращает фокус тому, что её открыло.
 */
export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showClose?: boolean;
  role?: 'dialog' | 'alertdialog';
  /** Кнопка, на которую ставится фокус при открытии. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Действия внизу окна. */
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

export function Modal({
  open,
  onClose,
  title = '',
  description = '',
  size = 'md',
  closeLabel = t('Закрыть'),
  closeOnBackdrop = true,
  closeOnEscape = true,
  showClose = true,
  role = 'dialog',
  initialFocus,
  footer,
  className,
  children,
}: ModalProps) {
  const panel = React.useRef<HTMLElement | null>(null);
  const lastFocused = React.useRef<HTMLElement | null>(null);
  const uid = React.useMemo(() => ++counter, []);
  const titleId = `ui-modal-title-${uid}`;
  const descriptionId = `ui-modal-description-${uid}`;

  React.useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    lockScroll();

    const frame = window.requestAnimationFrame(() => {
      // Фокус берёт запрошенный элемент или сама панель: первый контрол сразу
      // показал бы свою подсказку в момент открытия.
      (initialFocus?.current || panel.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      unlockScroll();
      lastFocused.current?.focus?.();
      lastFocused.current = null;
    };
  }, [open, initialFocus]);

  React.useEffect(() => {
    if (!open) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const all = focusables(panel.current);
      if (!all.length) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      const first = all[0];
      const last = all[all.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      {closeOnBackdrop ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeLabel}
          className="absolute inset-0 h-full w-full cursor-default bg-black/20 backdrop-blur-sm"
          onClick={onClose}
        />
      ) : (
        <div
          className="absolute inset-0 h-full w-full bg-black/20 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}
      <section
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 max-h-[calc(100dvh-4rem)] w-full overflow-y-auto rounded-ui border border-line bg-canvas p-6 text-ink shadow-overlay outline-none sm:p-8',
          SIZES[size],
          className,
        )}
      >
        {showClose ? (
          <IconButton
            label={closeLabel}
            variant="ghost"
            size="sm"
            tooltipText=""
            className="absolute right-3 top-3"
            onClick={onClose}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m6 6 12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        ) : null}

        {title ? (
          <h2 id={titleId} className="pr-10 text-lg font-bold tracking-tight">
            {title}
          </h2>
        ) : null}
        {description ? (
          <p id={descriptionId} className="mt-1.5 text-xs leading-relaxed text-ink-soft">
            {description}
          </p>
        ) : null}

        <div className="mt-4">{children}</div>

        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div> : null}
      </section>
    </div>
  );
}
