'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import BitrixText from '@/components/BitrixText';
import LoadingState from '@/components/LoadingState';
import { Avatar } from '@/components/monos/Avatar';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { IconButton } from '@/components/monos/IconButton';
import { TextField } from '@/components/monos/TextField';
import type { PortalNotification } from '@/lib/portal-notifications';
import { dateFormat, t } from '@/lib/i18n';

const DATE = dateFormat({ dateStyle: 'medium', timeStyle: 'short' });

const post = (body: Record<string, unknown>) =>
  fetch('/api/portal-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);

/**
 * Колокольчик Битрикса: приглашения на встречи с кнопками, напоминания, назначения в
 * задачах, почта. Открытая страница отмечает непрочитанные прочитанными, как в портале.
 */
export default function PortalNotifications({ onUnread }: { onUnread?: (count: number) => void }) {
  const [items, setItems] = useState<PortalNotification[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [answering, setAnswering] = useState<number | null>(null);
  const [answer, setAnswer] = useState('');
  const marked = useRef(new Set<number>());
  // В ref, а не в зависимостях: новая функция от родителя перезапускала бы загрузку.
  const unreadRef = useRef(onUnread);
  useEffect(() => {
    unreadRef.current = onUnread;
  }, [onUnread]);

  // Прочитанными отмечаем только то, что человек увидел на экране, одним вызовом.
  const markSeen = useCallback((list: PortalNotification[]) => {
    const ids = list.filter((item) => !item.read && !marked.current.has(item.id)).map((i) => i.id);
    if (!ids.length) return;
    ids.forEach((id) => marked.current.add(id));
    void post({ action: 'read', ids }).then((response) => {
      if (response?.ok) unreadRef.current?.(0);
    });
  }, []);

  const load = useCallback(
    async (after?: PortalNotification) => {
      const query = after ? `?lastId=${after.id}&lastType=${after.type}` : '';
      const response = await fetch(`/api/portal-notifications${query}`).catch(() => null);
      const data = response?.ok ? await response.json().catch(() => null) : null;
      if (!data) {
        setError(t('Не удалось загрузить уведомления Битрикс24.'));
        if (!after) setItems([]);
        return;
      }
      setError('');
      setHasMore(Boolean(data.hasMore));
      setItems((current) => (after ? [...(current || []), ...data.items] : data.items));
      if (!after) unreadRef.current?.(data.unread);
      markSeen(data.items);
    },
    [markSeen],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const remove = (id: number) =>
    setItems((current) => current && current.filter((item) => item.id !== id));

  async function confirm(item: PortalNotification, value: string) {
    setBusy(item.id);
    const response = await post({ action: 'confirm', id: item.id, value });
    setBusy(null);
    if (response?.status === 409) {
      setStatus(t('Это приглашение уже обработано.'));
      remove(item.id);
      return;
    }
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (!data) {
      setError(t('Не удалось ответить на приглашение. Попробуйте ещё раз.'));
      return;
    }
    // Портал сам удаляет уведомление после нажатия кнопки.
    remove(item.id);
    setStatus(data.message || t('Ответ отправлен'));
  }

  async function sendAnswer(item: PortalNotification) {
    const text = answer.trim();
    if (!text) return;
    setBusy(item.id);
    const response = await post({ action: 'answer', id: item.id, text });
    setBusy(null);
    if (!response?.ok) {
      setError(
        response?.status === 409
          ? t('На это уведомление нельзя ответить.')
          : t('Ответ не отправился. Попробуйте ещё раз.'),
      );
      return;
    }
    setAnswering(null);
    setAnswer('');
    setStatus(t('Ответ отправлен'));
  }

  async function del(item: PortalNotification) {
    setBusy(item.id);
    const response = await post({ action: 'delete', id: item.id });
    setBusy(null);
    if (!response?.ok) {
      setError(t('Не удалось удалить уведомление.'));
      return;
    }
    remove(item.id);
  }

  async function more() {
    const last = items?.at(-1);
    if (!last || loadingMore) return;
    setLoadingMore(true);
    await load(last);
    setLoadingMore(false);
  }

  if (items === null) return <LoadingState className="min-h-40 bg-transparent" />;

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm text-ink-soft">
          {status}
        </p>
      )}
      {items.length === 0 && !error && (
        <Card padding="md">
          <p className="text-sm text-ink-soft">{t('В Битрикс24 нет уведомлений')}</p>
        </Card>
      )}
      <ul className="space-y-2" aria-label={t('Уведомления Битрикс24')}>
        {items.map((item) => (
          <li key={item.id}>
            <Card
              padding="md"
              className="[content-visibility:auto] [contain-intrinsic-size:auto_96px]"
            >
              <div className="flex gap-3">
                {item.author ? (
                  <Avatar name={item.author.name} src={item.author.avatar} size="sm" />
                ) : (
                  <span className="size-8 shrink-0" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                    {item.author && (
                      <span className="font-medium text-ink">{item.author.name}</span>
                    )}
                    <time dateTime={item.date}>
                      {item.date ? DATE.format(new Date(item.date)) : ''}
                    </time>
                    {!item.read && <Badge tone="accent">{t('новое')}</Badge>}
                  </div>
                  {item.title && <p className="text-sm font-bold text-ink">{item.title}</p>}
                  <div className="break-words text-sm text-ink">
                    <BitrixText text={item.text} />
                  </div>
                  {(item.buttons.length > 0 || item.canAnswer) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {item.buttons.map((button) => (
                        <Button
                          key={button.value}
                          size="sm"
                          variant={button.value === 'Y' ? 'primary' : 'secondary'}
                          disabled={busy === item.id}
                          onClick={() => void confirm(item, button.value)}
                        >
                          {button.text}
                        </Button>
                      ))}
                      {item.canAnswer && answering !== item.id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setAnswering(item.id);
                            setAnswer('');
                          }}
                        >
                          {t('Ответить')}
                        </Button>
                      )}
                    </div>
                  )}
                  {answering === item.id && (
                    <form
                      className="flex items-end gap-2 pt-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void sendAnswer(item);
                      }}
                    >
                      <TextField
                        label={t('Ответ')}
                        variant="boxed"
                        size="sm"
                        className="flex-1"
                        value={answer}
                        maxLength={5000}
                        autoFocus
                        onChange={(event) => setAnswer(event.target.value)}
                      />
                      <Button type="submit" size="sm" disabled={!answer.trim() || busy === item.id}>
                        {t('Отправить')}
                      </Button>
                    </form>
                  )}
                </div>
                <IconButton
                  label={t('Удалить уведомление')}
                  variant="ghost"
                  size="sm"
                  disabled={busy === item.id}
                  onClick={() => void del(item)}
                >
                  <Trash2 className="size-4" strokeWidth={1.7} />
                </IconButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="quiet" size="sm" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? t('Загрузка') : t('Показать ещё')}
          </Button>
        </div>
      )}
    </div>
  );
}
