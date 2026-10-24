// Общие мелочи мессенджера: форматирование времени и опрос.
import { useEffect } from 'react';

const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

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
