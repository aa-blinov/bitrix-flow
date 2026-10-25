'use client';

// Полоска «связь потеряна». Данные приходят из Битрикса потоком событий, и
// если поток оборвался, список молча устаревает — об этом нужно сказать.
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { subscribeToConnection } from '@/hooks/useSSE';
import { t } from '@/lib/i18n';

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
      className="sticky top-0 z-modal flex items-center justify-center gap-2 border-b border-line bg-surface px-4 py-1.5 text-xs text-warning-text"
    >
      <WifiOff className="size-3.5" strokeWidth={1.7} />
      {browserOffline
        ? t('Нет сети — данные на экране могли устареть')
        : t('Связь с сервером потеряна, обновления не приходят')}
    </div>
  );
}
