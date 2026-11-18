'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Пункты меню — это данные: компонент сам рисует кнопки, разделители и
 * состояния. `onSelect` вызывается у пункта, который выбрали.
 */
export type MenuItem = {
  value?: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onSelect?: (item: MenuItem) => void;
};

export type MenuProps = {
  items: MenuItem[];
  /** Доступное имя меню и текст кнопки по умолчанию. */
  label?: string;
  align?: 'start' | 'end';
  placement?: 'top' | 'bottom';
  width?: 'menu' | 'trigger' | 'auto';
  disabled?: boolean;
  /**
   * Свой элемент-триггер. Ему добавляются `onClick`, `aria-haspopup`,
   * `aria-expanded` и `ref` — остальное остаётся как было.
   */
  trigger?: React.ReactElement;
  className?: string;
  /**
   * Рисовать выпадашку порталом <body>. Нужен там, где меню живёт внутри
   * контейнера с overflow (колонка канбана): обычный absolute-поповер
   * обрезается скролл-контейнером, портал — нет. Позиция закрепляется за
   * триггером и следует за прокруткой окна и вложенных контейнеров.
   */
  portal?: boolean;
};

const WIDTHS: Record<'menu' | 'trigger' | 'auto', string> = {
  menu: 'w-56',
  trigger: 'w-full',
  auto: 'w-max min-w-full max-w-xs',
};

// В портал-режиме поповер фиксирован и не растягивается на вьюпорт:
// right-0/min-w-full там превращают меню в полосу шириной с экран.
const PORTAL_WIDTHS: Record<'menu' | 'trigger' | 'auto', string> = {
  menu: 'w-56',
  trigger: 'w-max min-w-40 max-w-xs',
  auto: 'w-max max-w-xs',
};

/** То, что триггер получает при клонировании. */
type TriggerProps = {
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  'aria-haspopup'?: React.AriaAttributes['aria-haspopup'];
  'aria-expanded'?: React.AriaAttributes['aria-expanded'];
  ref?: React.Ref<HTMLElement>;
};

/**
 * Меню с одной кнопкой. Клавиатура: стрелки и Home/End ходят по пунктам,
 * Escape закрывает и возвращает фокус на кнопку, Tab закрывает меню.
 * Клик мимо меню закрывает его.
 */
export function Menu({
  items,
  label = 'Menu',
  align = 'start',
  placement = 'bottom',
  width = 'menu',
  disabled = false,
  trigger,
  className,
  portal = false,
}: MenuProps) {
  const [open, setOpen] = React.useState(false);
  const [portalPos, setPortalPos] = React.useState<{
    left: number;
    top: number | null;
    bottom: number | null;
  } | null>(null);
  const anchor = React.useRef<HTMLDivElement | null>(null);
  const menuEl = React.useRef<HTMLDivElement | null>(null);
  const triggerEl = React.useRef<HTMLElement | null>(null);

  const enabledItems = React.useCallback(
    (): HTMLElement[] =>
      Array.from(
        menuEl.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      ),
    [],
  );

  const focusItem = React.useCallback(
    (index: number) => {
      const all = enabledItems();
      if (!all.length) return;
      const next = (index + all.length) % all.length;
      all[next]?.focus();
    },
    [enabledItems],
  );

  const close = React.useCallback((returnFocus = true) => {
    setOpen(false);
    if (!returnFocus) return;
    const target =
      anchor.current?.querySelector<HTMLElement>('button, [tabindex="0"]') ?? triggerEl.current;
    target?.focus();
  }, []);

  const toggle = React.useCallback(() => {
    if (disabled) return;
    setOpen((value) => !value);
  }, [disabled]);

  // Открытое меню сразу получает фокус на первом доступном пункте.
  React.useEffect(() => {
    if (open) focusItem(0);
  }, [open, focusItem]);

  // Позиция портального поповера привязана к триггеру. Слушаем прокрутку на
  // capture-фазе: выпадашка уезжает и со скроллом окна, и со скроллом
  // контейнеров, в которых лежит триггер (колонка канбана).
  React.useEffect(() => {
    if (!open) {
      setPortalPos(null);
      return;
    }
    if (!portal) return;
    const measure = () => {
      const rect = triggerEl.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 4;
      setPortalPos(
        placement === 'top'
          ? { left: rect.right, top: null, bottom: window.innerHeight - rect.top + margin }
          : // align=end выравнивает влево своим правым краем по правому краю
            // триггера: сдвиг на 100% своей ширины делается в стиле ниже.
            { left: rect.right, top: rect.bottom + margin, bottom: null },
      );
    };
    // После layout, а не в теле эффекта: измерять до отрисовки бессмысленно.
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, portal, placement]);

  // Клик мимо меню закрывает его и не возвращает фокус: клик и так уводит
  // фокус на цель клика.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!anchor.current?.contains(target) && !target.closest?.('[data-ui-portal]'))
        setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    item.onSelect?.(item);
    close();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const all = enabledItems();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(all.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const originalRef = trigger ? (trigger as React.ReactElement<TriggerProps>).props.ref : undefined;

  // Свой `ref` триггера не теряем: иначе вызывающий код не сможет измерить
  // или спрятать кнопку.
  const composedRef = React.useCallback(
    (node: HTMLElement | null) => {
      triggerEl.current = node;
      if (typeof originalRef === 'function') originalRef(node);
      else if (originalRef) originalRef.current = node;
    },
    [originalRef],
  );

  const triggerNode = trigger ? (
    React.cloneElement(trigger as React.ReactElement<TriggerProps>, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        (trigger as React.ReactElement<TriggerProps>).props.onClick?.(event);
        toggle();
      },
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      ref: composedRef,
    })
  ) : (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      onClick={toggle}
      className="inline-flex min-h-9 items-center gap-2 rounded-ui px-3 text-sm text-ink-soft transition-colors duration-fast hover:text-ink"
    >
      {label}
      <ChevronRight
        className={cn('h-3.5 w-3.5 transition-transform duration-fast', open && '-rotate-90')}
        strokeWidth={1.7}
        aria-hidden="true"
      />
    </button>
  );

  const popoverNode = (
    <div
      ref={menuEl}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={cn(
        portal
          ? 'fixed z-menu max-h-[min(60vh,20rem)] overflow-y-auto rounded-ui border border-line bg-canvas p-1 shadow-overlay'
          : 'absolute z-menu overflow-y-auto rounded-ui border border-line bg-canvas p-1 shadow-overlay',
        portal ? PORTAL_WIDTHS[width] : WIDTHS[width],
        // В портал-режиме позиция задаётся стилем, align-классы конфликтуют
        // с ней (right-0 растягивает fixed-элемент до вьюпорта).
        !portal && (align === 'end' ? 'right-0' : 'left-0'),
        !portal && (placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'),
      )}
      style={
        portal && portalPos
          ? {
              left: portalPos.left,
              top: portalPos.top ?? undefined,
              bottom: portalPos.bottom ?? undefined,
              // align=end выравнивает по правому краю триггера: знаем ширину
              // только после отрисовки, поэтому сдвигаем на 100% своей ширины.
              transform: align === 'end' ? 'translateX(-100%)' : undefined,
            }
          : undefined
      }
      onKeyDown={onMenuKeyDown}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div
            key={item.value ?? item.label ?? index}
            className="my-1 h-px bg-line"
            role="separator"
            aria-hidden="true"
          />
        ) : (
          <button
            key={item.value ?? item.label ?? index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cn(
              'flex min-h-8 w-full items-center max-sm:min-h-11 gap-2.5 rounded-ui px-3 text-left text-sm outline-none transition-colors duration-fast focus:bg-surface focus:text-ink',
              item.danger
                ? 'text-danger-text hover:bg-[color-mix(in_srgb,var(--ui-danger)_10%,transparent)] hover:text-danger-text'
                : 'text-ink-soft hover:bg-surface hover:text-ink',
              'disabled:cursor-not-allowed disabled:opacity-30',
            )}
            onClick={() => choose(item)}
          >
            {item.icon ? (
              <span className="shrink-0" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span className="truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );

  return (
    <div ref={anchor} className={cn('relative inline-block', className)}>
      {triggerNode}

      {open && portal
        ? (typeof document !== 'undefined' &&
            createPortal(<div data-ui-portal="">{popoverNode}</div>, document.body)) ||
          null
        : open
          ? popoverNode
          : null}
    </div>
  );
}
