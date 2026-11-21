'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { IconButton } from '@/components/monos/IconButton';
import { t } from '@/lib/i18n';

const CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * Плашка «вышла новая версия». Версия — идентификатор сборки: пока вкладка
 * открыта, деплой меняет ответ /api/version, и вместо устаревшего интерфейса
 * предлагаем обновиться одной кнопкой. Без навязчивой перезагрузки: пользователь
 * решает сам, когда прерваться.
 */
export default function UpdateNotice() {
  // Базовая версия в ref: в состоянии её смена перезапускала эффект и сразу слала второй запрос.
  const baseVersion = useRef<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/version', { cache: 'no-store' });
      const data = await response.json();
      if (typeof data.version !== 'string' || !data.version) return;
      if (!baseVersion.current) baseVersion.current = data.version;
      else if (data.version !== baseVersion.current) setUpdateAvailable(true);
    } catch {
      // Сеть или деплой в процессе — молча ждём следующей проверки.
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    // Вернулись на вкладку после часа в стороне — проверяем сразу, а не через интервал.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed right-4 bottom-20 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-ui border border-line bg-surface p-3 shadow-overlay lg:bottom-4"
    >
      <p className="text-sm text-ink">{t('Вышла новая версия приложения')}</p>
      <Button
        size="sm"
        icon={<RefreshCw size={14} strokeWidth={1.7} />}
        onClick={() => window.location.reload()}
      >
        {t('Обновить')}
      </Button>
      <IconButton label={t('Позже')} variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        <X size={14} strokeWidth={1.7} />
      </IconButton>
    </div>
  );
}
