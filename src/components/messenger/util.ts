// Общие мелочи мессенджера: форматирование времени и опрос.
import { useEffect } from 'react';
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
// портал круглосуточно.
export function usePolling(run: () => void, delay: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, delay);
    return () => window.clearInterval(timer);
  }, [run, delay, enabled]);
}
