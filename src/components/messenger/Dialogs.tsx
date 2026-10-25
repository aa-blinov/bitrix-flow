'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/monos/Avatar';
import { Button } from '@/components/monos/Button';
import { Modal } from '@/components/monos/Modal';
import { SearchField } from '@/components/monos/SearchField';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { TextField } from '@/components/monos/TextField';
import { PresenceDot } from '@/components/messenger/Presence';
import { presenceText, type Dialog, type UserHit } from '@/lib/messenger';

// Поиск людей по порталу: портал ищет от двух букв, поэтому короче не спрашиваем.
// Запрос уходит после паузы в наборе, чтобы не слать по запросу на каждую букву.
function useUserSearch(query: string, enabled: boolean) {
  const [hits, setHits] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const needle = query.trim();
  useEffect(() => {
    if (!enabled || needle.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/messenger/users?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { users: [] }))
        .then((data) => setHits(data.users))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [needle, enabled]);
  return { hits, searching, needle };
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
  const { hits, searching, needle } = useUserSearch(query, open);

  // Закрытое окно открывается чистым, а не с прошлым поиском.
  useEffect(() => {
    if (open) return;
    setMode('user');
    setQuery('');
    setPicked([]);
    setTitle('');
    setError('');
  }, [open]);

  async function createGroup() {
    if (!title.trim() || !picked.length || creating) return;
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/messenger/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), userIds: picked.map((user) => user.id) }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      onOpen({ id: data.dialogId, kind: 'chat', title: title.trim() });
    } catch {
      setError('Не удалось создать чат. Попробуйте ещё раз.');
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
    <Modal open={open} onClose={onClose} title="Новый чат" size="md">
      <div className="space-y-3">
        <SegmentedControl
          label="Тип чата"
          size="sm"
          options={[
            { value: 'user', label: 'Личный' },
            { value: 'group', label: 'Группа' },
          ]}
          value={mode}
          onChange={(value) => setMode(value as 'user' | 'group')}
        />
        {mode === 'group' && (
          <TextField
            id="new-chat-title"
            label="Название группы"
            variant="boxed"
            size="sm"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
        {mode === 'group' && picked.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Участники">
            {picked.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => toggle(user)}
                  aria-label={`Убрать ${user.name}`}
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
          label="Найти человека"
          placeholder="Найти человека (от двух букв)"
          size="sm"
          value={query}
          onChange={setQuery}
        />
        <div className="max-h-64 overflow-y-auto" aria-busy={searching}>
          {needle.length < 2 ? (
            <p className="p-2 text-xs text-ink-soft">Введите имя или фамилию</p>
          ) : hits.length === 0 ? (
            <p className="p-2 text-xs text-ink-soft">{searching ? 'Поиск' : 'Никого не нашли'}</p>
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
              {creating ? 'Создаём' : 'Создать группу'}
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
    <Modal open={open} onClose={onClose} title="Переслать в чат" size="md">
      <div className="space-y-3">
        <SearchField
          id="forward-search"
          label="Найти чат"
          placeholder="Найти чат"
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
          {shown.length === 0 && <li className="p-2 text-xs text-ink-soft">Ничего не найдено</li>}
        </ul>
      </div>
    </Modal>
  );
}
