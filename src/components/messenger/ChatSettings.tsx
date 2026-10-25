'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PresenceDot } from '@/components/messenger/Presence';
import { AlertDialog } from '@/components/monos/AlertDialog';
import { Avatar } from '@/components/monos/Avatar';
import { Button } from '@/components/monos/Button';
import { Modal } from '@/components/monos/Modal';
import { SearchField } from '@/components/monos/SearchField';
import { TextField } from '@/components/monos/TextField';
import type { Dialog, UserHit } from '@/lib/messenger';

const post = (body: Record<string, unknown>) =>
  fetch('/api/messenger/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => {
    if (!response.ok) throw new Error(String(response.status));
  });

// Настройки обычного группового чата: название, участники и выход. Права на каждое
// действие проверяет портал; отказ показываем как есть, а не прячем кнопки наугад.
export function ChatSettingsModal({
  open,
  dialog,
  me,
  onClose,
  onRenamed,
  onLeft,
}: {
  open: boolean;
  dialog: Dialog;
  me: number;
  onClose: () => void;
  onRenamed: (title: string) => void;
  onLeft: () => void;
}) {
  const [title, setTitle] = useState(dialog.title);
  const [members, setMembers] = useState<UserHit[] | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const loadMembers = useCallback(() => {
    void fetch(`/api/messenger/users?dialogId=${encodeURIComponent(dialog.id)}`)
      .then((response) => (response.ok ? response.json() : { users: [] }))
      .then((data) => setMembers(data.users))
      .catch(() => setMembers([]));
  }, [dialog.id]);

  useEffect(() => {
    if (!open) return;
    setTitle(dialog.title);
    setError('');
    setQuery('');
    loadMembers();
  }, [open, dialog.title, loadMembers]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/messenger/users?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { users: [] }))
        .then((data) => setHits(data.users))
        .catch(() => {});
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set((members || []).map((member) => member.id));
  const candidates = hits.filter((user) => !memberIds.has(user.id));

  return (
    <>
      <Modal open={open} onClose={onClose} title="Настройки чата" size="md">
        <div className="space-y-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = title.trim();
              if (!next || next === dialog.title) return;
              void run(async () => {
                await post({ dialogId: dialog.id, action: 'rename', title: next });
                onRenamed(next);
              }, 'Не удалось переименовать: менять название может владелец чата.');
            }}
          >
            <TextField
              id="chat-settings-title"
              label="Название"
              variant="boxed"
              size="sm"
              className="flex-1"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button type="submit" disabled={busy || !title.trim() || title.trim() === dialog.title}>
              Сохранить
            </Button>
          </form>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-widest text-ink-soft">
              Участники{members ? ` (${members.length})` : ''}
            </p>
            <ul className="max-h-48 overflow-y-auto" aria-label="Участники чата">
              {(members || []).map((member) => (
                <li key={member.id} className="flex min-h-11 items-center gap-3 px-1">
                  <Avatar name={member.name} src={member.avatar} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{member.name}</span>
                  <PresenceDot presence={member.presence} />
                  {member.id !== me && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Исключить ${member.name}`}
                      onClick={() =>
                        void run(async () => {
                          await post({ dialogId: dialog.id, action: 'remove', userId: member.id });
                          loadMembers();
                        }, 'Не удалось исключить: на это нужны права в чате.')
                      }
                      className="shrink-0 text-ink-soft hover:text-ink disabled:opacity-30"
                    >
                      <X className="size-4" strokeWidth={1.7} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <SearchField
              id="chat-settings-add"
              label="Добавить участника"
              placeholder="Добавить участника (от двух букв)"
              size="sm"
              value={query}
              onChange={setQuery}
            />
            {candidates.length > 0 && (
              <ul className="max-h-40 overflow-y-auto" aria-label="Кого добавить">
                {candidates.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await post({ dialogId: dialog.id, action: 'add', userIds: [user.id] });
                          setQuery('');
                          loadMembers();
                        }, 'Не удалось добавить: на это нужны права в чате.')
                      }
                      className="flex min-h-11 w-full items-center gap-3 rounded-ui px-2 py-1.5 text-left hover:bg-surface-2"
                    >
                      <Avatar name={user.name} src={user.avatar} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{user.name}</span>
                      <span className="text-xs text-ink-soft">Добавить</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmLeave(true)}>
              Выйти из чата
            </Button>
          </div>
        </div>
      </Modal>
      <AlertDialog
        open={confirmLeave}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          void run(async () => {
            await post({ dialogId: dialog.id, action: 'leave' });
            onLeft();
          }, 'Не удалось выйти из чата.');
        }}
        title="Выйти из чата?"
        description="Чат пропадёт из списка, историю вы больше не увидите, пока вас не добавят снова."
        confirmLabel="Выйти"
      />
    </>
  );
}
