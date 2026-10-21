'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  title?: string;
  description?: string;
  closeLabel?: string;
  className?: string;
  children?: React.ReactNode;
};

let counter = 0;

// Анимация приезда живёт здесь, а не в общих стилях: правило набора
// относится к самому ящику, и в глобальный CSS ему не место.
const DRAWER_CSS = `
.ui-drawer {
  animation: ui-drawer-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes ui-drawer-in {
  from {
    opacity: 0.6;
    transform: translateX(var(--ui-drawer-from));
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-drawer {
    animation: none;
  }
}
`;

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
 * Ящик — это модальное окно сбоку: фокус заперт внутри, страница не
 * скроллится, Escape и фон закрывают ящик, а фокус возвращается тому, что
 * его открыло.
 */
export function Drawer({
  open,
  onClose,
  side = 'right',
  title = '',
  description = '',
  closeLabel = 'Закрыть',
  className,
  children,
}: DrawerProps) {
  const panel = React.useRef<HTMLElement | null>(null);
  const lastFocused = React.useRef<HTMLElement | null>(null);
  const uid = React.useMemo(() => ++counter, []);
  const titleId = `ui-drawer-title-${uid}`;
  const descriptionId = `ui-drawer-description-${uid}`;

  React.useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    lockScroll();

    const frame = window.requestAnimationFrame(() => {
      panel.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      unlockScroll();
      lastFocused.current?.focus?.();
      lastFocused.current = null;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <style>{DRAWER_CSS}</style>
      <div className="fixed inset-0 z-modal">
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeLabel}
          className="absolute inset-0 h-full w-full cursor-default bg-black/20 backdrop-blur-sm"
          onClick={onClose}
        />
        <section
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cn(
            'ui-drawer absolute inset-y-0',
            side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
            'w-full overflow-y-auto border-line bg-canvas p-6 text-ink shadow-overlay outline-none',
            'max-w-md',
            className,
          )}
          style={{ '--ui-drawer-from': side === 'left' ? '-100%' : '100%' } as React.CSSProperties}
        >
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
        </section>
      </div>
    </>
  );
}
