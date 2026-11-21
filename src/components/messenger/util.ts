// Общие мелочи мессенджера: форматирование времени и опрос.
import { useEffect, useRef } from 'react';
import { dateFormat } from '@/lib/i18n';

const TIME = dateFormat({ hour: '2-digit', minute: '2-digit' });
const DAY = dateFormat({ day: 'numeric', month: 'short' });

export function when(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toDateString() === new Date().toDateString()
    ? TIME.format(parsed)
    : DAY.format(parsed);
}

// Опрос стоит только пока вкладка видна: фоновая вкладка иначе читала бы
// портал круглосуточно. Сразу запрос идёт только при включении: смена функции
// (пришёл свой id) или интервала (подключился SSE) раньше давала ещё по запросу,
// и мессенджер грузил список диалогов трижды подряд.
export function usePolling(run: () => void, delay: number, enabled = true) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);
  useEffect(() => {
    if (enabled) latest.current();
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') latest.current();
    }, delay);
    return () => window.clearInterval(timer);
  }, [delay, enabled]);
}
