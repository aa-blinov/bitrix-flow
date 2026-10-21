'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PopoverProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Якорь. Если его нет, компонент рисует свою кнопку. */
  trigger?: React.ReactElement;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  children?: React.ReactNode;
};

let counter = 0;

/** То, что триггер получает при клонировании. */
type TriggerProps = {
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  'aria-haspopup'?: React.AriaAttributes['aria-haspopup'];
  'aria-expanded'?: React.AriaAttributes['aria-expanded'];
  'aria-controls'?: React.AriaAttributes['aria-controls'];
  ref?: React.Ref<HTMLElement>;
};

const POSITIONS: Record<'top' | 'bottom' | 'left' | 'right', string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
  left: 'right-full mr-2',
  right: 'left-full ml-2',
};

const OPPOSITE: Record<'top' | 'bottom' | 'left' | 'right', 'top' | 'bottom' | 'left' | 'right'> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/**
 * Панель с произвольным содержимым, привязанная к кнопке. Это не модальное
 * окно: фокус внутри неё не заперт. Закрывается по Escape и по клику мимо,
 * а если снизу не хватает места — переворачивается над кнопкой.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  placement = 'bottom',
  className,
  children,
}: PopoverProps) {
  const controlled = open !== undefined;
  const [internal, setInternal] = React.useState(false);
  const isOpen = controlled ? open : internal;

  const anchor = React.useRef<HTMLDivElement | null>(null);
  const triggerEl = React.useRef<HTMLElement | null>(null);
  const panelEl = React.useRef<HTMLDivElement | null>(null);
  const [flipped, setFlipped] = React.useState(false);

  const panelId = React.useMemo(() => `ui-popover-${++counter}`, []);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!controlled) setInternal(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const triggerNode = React.useCallback((): HTMLElement | null => {
    return (
      triggerEl.current ??
      anchor.current?.querySelector<HTMLElement>('button, [tabindex="0"], a[href]') ??
      null
    );
  }, []);

  const close = React.useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setFlipped(false);
      if (returnFocus) triggerNode()?.focus();
    },
    [setOpen, triggerNode],
  );

  const toggle = React.useCallback(() => {
    if (isOpen) close(false);
    else setOpen(true);
  }, [close, isOpen, setOpen]);

  // Места сверху или снизу может не хватить — тогда панель переворачивается.
  React.useEffect(() => {
    if (!isOpen) {
      setFlipped(false);
      return;
    }
    const trigger = triggerNode();
    const panel = panelEl.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    if (placement === 'bottom') {
      setFlipped(rect.bottom + panel.offsetHeight + 8 > window.innerHeight);
    } else if (placement === 'top') {
      setFlipped(rect.top - panel.offsetHeight - 8 < 0);
    } else if (placement === 'left') {
      setFlipped(rect.left - panel.offsetWidth - 8 < 0);
    } else {
      setFlipped(rect.right + panel.offsetWidth + 8 > window.innerWidth);
    }
  }, [isOpen, placement, triggerNode]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      // Escape закрывает поповер, а не всё, что под ним: на телефоне поповер с
      // фильтрами лежит внутри ящика, и без остановки распространения ящик
      // закрывался вместе с ним — фильтры вместе с условиями.
      event.stopPropagation();
      close(true);
    };
    // Захват на документе: обработчики ящика и окна висят на document и
    // срабатывают раньше, чем всплытие до window.
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [close, isOpen]);

  const originalRef = trigger ? (trigger as React.ReactElement<TriggerProps>).props.ref : undefined;

  // Свой `ref` триггера не теряем.
  const composedRef = React.useCallback(
    (node: HTMLElement | null) => {
      triggerEl.current = node;
      if (typeof originalRef === 'function') originalRef(node);
      else if (originalRef) originalRef.current = node;
    },
    [originalRef],
  );

  const triggerButton = trigger ? (
    React.cloneElement(trigger as React.ReactElement<TriggerProps>, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        (trigger as React.ReactElement<TriggerProps>).props.onClick?.(event);
        toggle();
      },
      'aria-haspopup': 'dialog',
      'aria-expanded': isOpen,
      'aria-controls': isOpen ? panelId : undefined,
      ref: composedRef,
    })
  ) : (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={isOpen ? panelId : undefined}
      onClick={toggle}
      className="inline-flex min-h-9 items-center gap-2 rounded-ui px-3 text-sm max-sm:min-h-11 text-ink-soft transition-colors duration-fast hover:text-ink"
    >
      Open
      <ChevronDown
        className={cn('h-3.5 w-3.5 transition-transform duration-fast', isOpen && 'rotate-180')}
        strokeWidth={1.7}
        aria-hidden="true"
      />
    </button>
  );

  const actualPlacement = flipped ? OPPOSITE[placement] : placement;
  const alignClass = actualPlacement === 'left' || actualPlacement === 'right' ? 'top-0' : 'left-0';

  return (
    <div ref={anchor} className={cn('relative inline-block', className)}>
      {triggerButton}

      {isOpen ? (
        <div
          ref={panelEl}
          id={panelId}
          role="dialog"
          tabIndex={-1}
          className={cn(
            'absolute z-menu max-h-[min(24rem,calc(100dvh-6rem))] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-ui border border-line bg-canvas p-4 shadow-overlay',
            'w-72',
            POSITIONS[actualPlacement],
            alignClass,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
