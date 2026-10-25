'use client';

import { useState } from 'react';
import { Button } from '@/components/monos/Button';
import { t } from '@/lib/i18n';

export type MediaStatus = 'loading' | 'ready' | 'error';

// Состояние загрузки одного медиафайла. Файл идёт с портала через наш роут,
// а портал бывает медленным или обрывает соединение, поэтому у фото, видео и
// звука есть три честных состояния вместо пустого места или битой иконки.
export function useMediaLoad(initial: MediaStatus = 'loading') {
  const [status, setStatus] = useState<MediaStatus>(initial);
  const [attempt, setAttempt] = useState(0);
  return {
    status,
    attempt,
    onReady: () => setStatus('ready'),
    onError: () => setStatus('error'),
    onLoading: () => setStatus('loading'),
    retry: () => {
      setStatus('loading');
      setAttempt((count) => count + 1);
    },
    // Повтор идёт новым адресом: иначе браузер мог бы отдать неудачный ответ из кэша.
    url: (src: string) => (attempt ? `${src}&retry=${attempt}` : src),
  };
}

export function MediaError({
  name,
  onRetry,
  className = 'mt-1',
}: {
  name: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`${className} flex items-center gap-2 rounded-ui border border-line px-2 py-1.5 text-sm text-ink-soft`}
    >
      <span className="min-w-0 flex-1 truncate">
        {t('Не удалось загрузить')} {name}
      </span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {t('Повторить')}
      </Button>
    </div>
  );
}
