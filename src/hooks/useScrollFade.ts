import { useEffect, useRef, useState } from 'react';

/**
 * Колонок больше, чем влезает: без затухания у правого края таблица выглядит обрезанной
 * по ошибке. Класс включается, пока справа остаётся непрокрученное.
 */
export function useScrollFade<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const className = more
    ? '[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]'
    : '';
  return { ref, className };
}
