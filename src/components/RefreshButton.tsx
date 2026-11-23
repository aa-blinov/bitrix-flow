'use client';

import { useRef, useState } from 'react';
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
  label,
  title,
  doneText,
  busy: externalBusy = false,
}: {
  /** Должна завершиться, когда новые данные уже на экране, и отклониться при ошибке. */
  onRefresh: () => Promise<void>;
  className?: string;
  /** Подпись видна всегда. Без неё текст есть только на широком экране, иначе строка инструментов переносится. */
  label?: string;
  title?: string;
  /** Сообщение об успехе: для фонового сбора «список обновлён» было бы неправдой. */
  doneText?: string;
  /** Фоновое обновление уже идёт (после перезагрузки страницы тоже): кнопка крутится и не нажимается. */
  busy?: boolean;
}) {
  const [ownBusy, setBusy] = useState(false);
  // Состояние меняется только после рендера, а ref сразу: двойной клик не успеет пройти дважды.
  const lock = useRef(false);
  const busy = ownBusy || externalBusy;
  const toast = useToast();

  const click = async () => {
    if (busy || lock.current) return;
    lock.current = true;
    setBusy(true);
    const started = Date.now();
    try {
      await onRefresh();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, MIN_SPIN_MS - (Date.now() - started))),
      );
      toast({ title: doneText ?? t('Список обновлён'), tone: 'success', durationMs: 2000 });
    } catch {
      toast({
        title: t('Не удалось обновить'),
        description: t('Проверьте соединение и повторите'),
        tone: 'danger',
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={() => void click()}
      aria-label={label ?? t('Обновить список')}
      title={title ?? t('Загрузить свежие данные')}
      className={className}
      icon={<RefreshCw size={14} strokeWidth={1.7} />}
    >
      <span className={label ? undefined : 'hidden 2xl:inline'}>
        {busy ? t('Обновляем…') : (label ?? t('Обновить'))}
      </span>
    </Button>
  );
}
