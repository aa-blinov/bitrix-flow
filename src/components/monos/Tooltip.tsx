'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Подсказка на любом элементе. Один вид, одна задержка (450 мс под курсором,
 * мгновенно с клавиатуры) и никаких подсказок на телефоне: там нет наведения.
 *
 * Подсказка живёт в `body`: предок с `overflow: hidden` не может её обрезать.
 * Это визуальная подсказка, а не имя элемента — имя остаётся у самого элемента.
 */
export const HOVER_DELAY = 450;
const GAP = 8;
const MARGIN = 12;

const BASE =
  'pointer-events-none fixed z-tooltip max-w-xs rounded-ui border border-line bg-canvas px-3 py-2 text-ink shadow-overlay';
const SHORT = 'whitespace-nowrap text-whisper font-bold uppercase tracking-[0.14em]';
const LONG = 'whitespace-normal text-xs font-normal normal-case tracking-normal leading-relaxed';

export type TooltipPlacement = 'top' | 'bottom';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Поведение подсказки для одного элемента. Возвращает обработчики, которые
 * вешаются на узел: `onMouseEnter`, `onMouseLeave`, `onFocus`, `onBlur`,
 * `onKeyDown`, `onClick`.
 */
export function useTooltip(
  text: string,
  placement: TooltipPlacement = 'bottom',
): {
  handlers: Record<string, React.ReactEventHandler>;
  ref: React.RefObject<HTMLSpanElement | null>;
} {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [node, setNode] = React.useState<HTMLSpanElement | null>(null);
  const timer = React.useRef<number | null>(null);
  const element = React.useRef<HTMLDivElement | null>(null);

  const hide = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    element.current?.remove();
    element.current = null;
  }, []);

  const place = React.useCallback(() => {
    const tip = element.current;
    const anchor = ref.current?.firstElementChild ?? ref.current;
    if (!tip || !anchor) return;
    const anchorBox = anchor.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const maxLeft = Math.max(MARGIN, window.innerWidth - box.width - MARGIN);
    const maxTop = Math.max(MARGIN, window.innerHeight - box.height - MARGIN);

    const left = anchorBox.left + anchorBox.width / 2 - box.width / 2;
    let top = placement === 'top' ? anchorBox.top - box.height - GAP : anchorBox.bottom + GAP;
    if (top + box.height > window.innerHeight - MARGIN) top = anchorBox.top - box.height - GAP;
    if (top < MARGIN) top = anchorBox.bottom + GAP;

    tip.style.left = `${Math.round(clamp(left, MARGIN, maxLeft))}px`;
    tip.style.top = `${Math.round(clamp(top, MARGIN, maxTop))}px`;
  }, [placement]);

  const show = React.useCallback(() => {
    if (!text || typeof window === 'undefined' || window.innerWidth < 640) return;
    hide();
    const tip = document.createElement('div');
    tip.setAttribute('role', 'tooltip');
    tip.className = `${BASE} ${text.length > 32 ? LONG : SHORT}`;
    tip.textContent = text;
    document.body.appendChild(tip);
    element.current = tip;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  }, [hide, place, text]);

  const showLater = React.useCallback(() => {
    if (!text || typeof window === 'undefined' || window.innerWidth < 640) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(show, HOVER_DELAY);
  }, [show, text]);

  React.useEffect(() => {
    setNode(ref.current);
  }, []);

  React.useEffect(() => {
    const onScroll = () => hide();
    return () => {
      hide();
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [hide]);

  // Текст подсказки сменился — показанную подсказку убираем.
  React.useEffect(() => {
    hide();
  }, [text, hide]);

  const handlers = React.useMemo(
    () => ({
      onMouseEnter: showLater,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      onClick: hide,
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') hide();
      },
    }),
    [hide, show, showLater],
  );

  void node;

  return { handlers, ref };
}

export type TooltipProps = {
  /** Текст подсказки. */
  text: string;
  placement?: TooltipPlacement;
  className?: string;
  children: React.ReactNode;
};

/** Обёртка подсказки: `<Tooltip text="Удалить">…</Tooltip>`. */
export function Tooltip({ text, placement = 'bottom', className, children }: TooltipProps) {
  const { handlers, ref } = useTooltip(text, placement);

  return (
    <span ref={ref} className={cn('inline-flex', className)} {...handlers}>
      {children}
    </span>
  );
}
