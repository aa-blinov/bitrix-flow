'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { useToast } from '@/components/monos/toast';
import { t } from '@/lib/i18n';

// Список и без кнопки обновляется по событиям портала, но потерянное событие заметно
// только по устаревшим данным. Нажатие должно быть видно: крутилка, пока идёт запрос,
// и сообщение по итогу, иначе при тех же данных кнопка выглядит сломанной.
const MIN_SPIN_MS = 600;

export default function RefreshButton({
  onRefresh,
  className,
}: {
  /** Должна завершиться, когда новые данные уже на экране, и отклониться при ошибке. */
  onRefresh: () => Promise<void>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const click = async () => {
    if (busy) return;
    setBusy(true);
    const started = Date.now();
    try {
      await onRefresh();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, MIN_SPIN_MS - (Date.now() - started))),
      );
      toast({ title: t('Список обновлён'), tone: 'success', durationMs: 2000 });
    } catch {
      toast({
        title: t('Не удалось обновить'),
        description: t('Проверьте соединение и повторите'),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={() => void click()}
      aria-label={t('Обновить список')}
      title={t('Загрузить свежие данные')}
      className={className}
      icon={<RefreshCw size={14} strokeWidth={1.7} />}
    >
      <span className="hidden 2xl:inline">{busy ? t('Обновляем…') : t('Обновить')}</span>
    </Button>
  );
}
