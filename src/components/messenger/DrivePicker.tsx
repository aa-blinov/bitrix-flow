'use client';

import { ChevronRight, File, Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import LoadingState from '@/components/LoadingState';
import { Button } from '@/components/monos/Button';
import { Modal } from '@/components/monos/Modal';
import { formatBytes } from '@/lib/messenger';
import { t } from '@/lib/i18n';

type Item = { id: number; name: string; type: 'folder' | 'file'; size: number };

/**
 * Файлы с личного Диска в чат: листаем папки, отмечаем файлы, отправляем одним
 * im.disk.file.commit. Файл не скачивается и не загружается заново, портал делает копию сам.
 */
export function DrivePicker({
  open,
  dialogId,
  onClose,
  onSent,
}: {
  open: boolean;
  dialogId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  // Путь от корня: корень без номера, его номер знает только сервер.
  const [path, setPathState] = useState<{ id: number | null; name: string }[]>(() => [
    { id: null, name: t('Мой Диск') },
  ]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const folderId = path.at(-1)?.id ?? null;

  // Переход в другую папку сразу показывает загрузку, а не старое содержимое.
  const setPath = (next: typeof path) => {
    setItems(null);
    setPathState(next);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/messenger/disk${folderId ? `?folderId=${folderId}` : ''}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setError(t('Не удалось открыть Диск. Попробуйте ещё раз.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, folderId]);

  async function send() {
    if (!picked.length || sending) return;
    setSending(true);
    setError('');
    const response = await fetch('/api/messenger/disk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'commit', dialogId, fileIds: picked.map((item) => item.id) }),
    }).catch(() => null);
    setSending(false);
    // Нет ответа: файл мог уйти, повтор дал бы второе сообщение.
    if (!response || response.status >= 500) {
      setError(t('Не удалось узнать, ушли ли файлы. Проверьте переписку, прежде чем повторять.'));
      return;
    }
    if (!response.ok) {
      setError(t('Не удалось отправить файлы с Диска.'));
      return;
    }
    onSent();
    onClose();
  }

  const toggle = (item: Item) =>
    setPicked((current) =>
      current.some((one) => one.id === item.id)
        ? current.filter((one) => one.id !== item.id)
        : current.length >= 10
          ? current
          : [...current, item],
    );

  return (
    <Modal open={open} onClose={onClose} title={t('Файл с Диска')} size="md">
      <div className="space-y-3">
        <nav aria-label={t('Путь на Диске')} className="flex flex-wrap items-center gap-1 text-sm">
          {path.map((step, index) => (
            <span key={`${step.id}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-3.5 text-ink-soft" strokeWidth={1.7} />}
              <button
                type="button"
                disabled={index === path.length - 1}
                onClick={() => setPath(path.slice(0, index + 1))}
                className="text-accent-text hover:underline disabled:text-ink disabled:no-underline"
              >
                {step.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="max-h-72 overflow-y-auto rounded-ui border border-line">
          {items === null ? (
            <LoadingState className="min-h-32 bg-transparent" />
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-ink-soft">{t('Папка пуста')}</p>
          ) : (
            <ul aria-label={t('Файлы на Диске')}>
              {items.map((item) => {
                const selected = picked.some((one) => one.id === item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={item.type === 'file' ? selected : undefined}
                      onClick={() =>
                        item.type === 'folder'
                          ? setPath([...path, { id: item.id, name: item.name }])
                          : toggle(item)
                      }
                      className={`flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 ${
                        selected ? 'bg-surface-2' : ''
                      }`}
                    >
                      {item.type === 'folder' ? (
                        <Folder className="size-4 shrink-0 text-ink-soft" strokeWidth={1.7} />
                      ) : (
                        <File className="size-4 shrink-0 text-ink-soft" strokeWidth={1.7} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                      {item.type === 'file' && (
                        <span className="shrink-0 text-xs text-ink-soft">
                          {formatBytes(item.size)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-soft">
            {picked.length ? t('Выбрано: {0}', picked.length) : t('Выберите до 10 файлов')}
          </p>
          <Button onClick={() => void send()} disabled={!picked.length || sending}>
            {sending ? t('Отправка') : t('Отправить в чат')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
