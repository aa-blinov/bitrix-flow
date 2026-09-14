'use client';

// Полоска «связь потеряна». Данные приходят из Битрикса потоком событий, и
// если поток оборвался, список молча устаревает — об этом нужно сказать.
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { subscribeToConnection } from '@/hooks/useSSE';

export default function ConnectionStatus() {
  const [offline, setOffline] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToConnection((state) => setOffline(state === 'offline'));
    const online = () => setBrowserOffline(false);
    const lost = () => setBrowserOffline(true);
    setBrowserOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    window.addEventListener('online', online);
    window.addEventListener('offline', lost);
    return () => {
      unsubscribe();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', lost);
    };
  }, []);

  if (!offline && !browserOffline) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200"
    >
      <WifiOff className="size-3.5" />
      {browserOffline
        ? 'Нет сети — данные на экране могли устареть'
        : 'Связь с сервером потеряна, обновления не приходят'}
    </div>
  );
}
