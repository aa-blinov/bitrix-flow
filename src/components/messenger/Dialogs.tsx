'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/monos/Avatar';
import { Button } from '@/components/monos/Button';
import { Modal } from '@/components/monos/Modal';
import { SearchField } from '@/components/monos/SearchField';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { TextField } from '@/components/monos/TextField';
import { PresenceDot } from '@/components/messenger/Presence';
import { presenceText, type Dialog, type UserHit } from '@/lib/messenger';
import { t } from '@/lib/i18n';

// Поиск людей по порталу: портал ищет от двух букв, поэтому короче не спрашиваем.
// Запрос уходит после паузы в наборе, чтобы не слать по запросу на каждую букву.
function useUserSearch(query: string, enabled: boolean) {
  const [hits, setHits] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const needle = query.trim();
  useEffect(() => {
    // Люди прошлого запроса не должны оставаться нажимаемыми под новым.
    setHits([]);
    if (!enabled || needle.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/messenger/users?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => {
          setFailed(false);
          setHits(data.users);
          setSearching(false);
        })
        // Сбой поиска не выдаём за «Никого не нашли»; смена запроса отменяет прошлый.
        .catch((failure) => {
          if (failure?.name === 'AbortError') return;
          setHits([]);
          setFailed(true);
          setSearching(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [needle, enabled]);
  return { hits, searching, needle, failed };
}

function UserRow({
  user,
  onClick,
  selected,
}: {
  user: UserHit;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`flex min-h-11 w-full items-center gap-3 rounded-ui px-2 py-1.5 text-left hover:bg-surface-2 ${
          selected ? 'bg-surface-2' : ''
        }`}
      >
        <Avatar name={user.name} src={user.avatar} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{user.name}</span>
          {user.position && (
            <span className="block truncate text-xs text-ink-soft">{user.position}</span>
          )}
        </span>
        <PresenceDot presence={user.presence} />
        <span className="shrink-0 text-xs text-ink-soft">{presenceText(user.presence)}</span>
      </button>
    </li>
  );
}

type Opened = Pick<Dialog, 'id' | 'kind' | 'title' | 'avatar' | 'presence'>;

export function NewChatModal({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (dialog: Opened) => void;
}) {
  const [mode, setMode] = useState<'user' | 'group'>('user');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<UserHit[]>([]);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const { hits, searching, needle, failed } = useUserSearch(query, open);

  // Закрытое окно открывается чистым, а не с прошлым поиском.
  // Окно закрыли, пока создавалась группа: поздний ответ не переключает переписку.
  const session = useRef(0);
  useEffect(() => {
    session.current += 1;
    if (open) return;
    setMode('user');
    setQuery('');
    setPicked([]);
    setTitle('');
    setError('');
  }, [open]);

  async function createGroup() {
    if (!title.trim() || !picked.length || creating) return;
    const mine = session.current;
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/messenger/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), userIds: picked.map((user) => user.id) }),
      }).catch(() => null);
      // Нет ответа или портал не ответил: чат мог создаться, повтор дал бы второй.
      if (mine !== session.current) return;
      if (!response || response.status >= 500) {
        setError(
          t('Не удалось узнать, создался ли чат. Проверьте список диалогов, прежде чем повторять.'),
        );
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json().catch(() => null);
      // Портал ответил, но тело оборвалось: чат, скорее всего, создан.
      if (!data?.dialogId) {
        setError(
          t('Не удалось узнать, создался ли чат. Проверьте список диалогов, прежде чем повторять.'),
        );
        return;
      }
      if (mine === session.current)
        onOpen({ id: data.dialogId, kind: 'chat', title: title.trim() });
    } catch {
      // Окно закрыли и открыли заново: ошибка прошлой группы к нему не относится.
      if (mine === session.current) setError(t('Не удалось создать чат. Попробуйте ещё раз.'));
    } finally {
      setCreating(false);
    }
  }

  const toggle = (user: UserHit) =>
    setPicked((current) =>
      current.some((item) => item.id === user.id)
        ? current.filter((item) => item.id !== user.id)
        : [...current, user],
    );

  return (
    <Modal open={open} onClose={onClose} title={t('Новый чат')} size="md">
      <div className="space-y-3">
        <SegmentedControl
          label={t('Тип чата')}
          size="sm"
          options={[
            { value: 'user', label: t('Личный') },
            { value: 'group', label: t('Группа') },
          ]}
          value={mode}
          onChange={(value) => setMode(value as 'user' | 'group')}
        />
        {mode === 'group' && (
          <TextField
            id="new-chat-title"
            label={t('Название группы')}
            variant="boxed"
            size="sm"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
        {mode === 'group' && picked.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('Участники')}>
            {picked.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => toggle(user)}
                  aria-label={t('Убрать {0}', user.name)}
                  className="inline-flex items-center gap-1 rounded-ui border border-line px-2 py-1 text-xs text-ink hover:bg-surface-2"
                >
                  {user.name}
                  <X className="size-3" strokeWidth={1.7} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <SearchField
          id="new-chat-search"
          label={t('Найти человека')}
          placeholder={t('Найти человека (от двух букв)')}
          size="sm"
          value={query}
          onChange={setQuery}
        />
        <div className="max-h-64 overflow-y-auto" aria-busy={searching}>
          {needle.length < 2 ? (
            <p className="p-2 text-xs text-ink-soft">{t('Введите имя или фамилию')}</p>
          ) : hits.length === 0 ? (
            <p className="p-2 text-xs text-ink-soft">
              {searching
                ? t('Поиск')
                : failed
                  ? t('Поиск людей не выполнился. Измените запрос, чтобы попробовать ещё раз.')
                  : t('Никого не нашли')}
            </p>
          ) : (
            <ul>
              {hits.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  selected={mode === 'group' && picked.some((item) => item.id === user.id)}
                  onClick={() =>
                    mode === 'user'
                      ? onOpen({
                          id: String(user.id),
                          kind: 'user',
                          title: user.name,
                          avatar: user.avatar,
                          presence: user.presence,
                        })
                      : toggle(user)
                  }
                />
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        {mode === 'group' && (
          <div className="flex justify-end">
            <Button
              onClick={() => void createGroup()}
              disabled={!title.trim() || !picked.length || creating}
            >
              {creating ? t('Создаём') : t('Создать группу')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ForwardModal({
  open,
  dialogs,
  onPick,
  onClose,
}: {
  open: boolean;
  dialogs: Dialog[];
  onPick: (dialog: Dialog) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  const needle = query.trim().toLocaleLowerCase('ru');
  const shown = dialogs.filter(
    (dialog) => !needle || dialog.title.toLocaleLowerCase('ru').includes(needle),
  );
  return (
    <Modal open={open} onClose={onClose} title={t('Переслать в чат')} size="md">
      <div className="space-y-3">
        <SearchField
          id="forward-search"
          label={t('Найти чат')}
          placeholder={t('Найти чат')}
          size="sm"
          value={query}
          onChange={setQuery}
        />
        <ul className="max-h-72 overflow-y-auto">
          {shown.map((dialog) => (
            <li key={dialog.id}>
              <button
                type="button"
                onClick={() => onPick(dialog)}
                className="flex min-h-11 w-full items-center gap-3 rounded-ui px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <Avatar name={dialog.title} src={dialog.avatar} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{dialog.title}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="p-2 text-xs text-ink-soft">{t('Ничего не найдено')}</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
