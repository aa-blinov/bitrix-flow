'use client';

import { Crown, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PresenceDot } from '@/components/messenger/Presence';
import { AlertDialog } from '@/components/monos/AlertDialog';
import { Avatar } from '@/components/monos/Avatar';
import { Button } from '@/components/monos/Button';
import { Modal } from '@/components/monos/Modal';
import { SearchField } from '@/components/monos/SearchField';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { CHAT_COLORS, type Dialog, type UserHit } from '@/lib/messenger';
import { t } from '@/lib/i18n';

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
  onTitleSync,
  onLeft,
}: {
  open: boolean;
  dialog: Dialog;
  me: number;
  onClose: () => void;
  onRenamed: (title: string) => void;
  /** Название сверено с порталом: обновить его, не закрывая окно с предупреждением. */
  onTitleSync: (title: string) => void;
  onLeft: () => void;
}) {
  const [title, setTitle] = useState(dialog.title);
  const [members, setMembers] = useState<UserHit[] | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [newOwner, setNewOwner] = useState<UserHit | null>(null);
  // Описание и цвет приходят из im.dialog.get вместе с владельцем.
  const [description, setDescription] = useState('');
  const [savedDescription, setSavedDescription] = useState('');
  const [color, setColor] = useState('');
  const [notice, setNotice] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);

  // Состав перечитывается после каждого действия: применяем только последний ответ,
  // иначе поздний старый вернул бы исключённого участника.
  const membersSeq = useRef(0);
  const loadMembers = useCallback(() => {
    const mine = ++membersSeq.current;
    return (
      fetch(`/api/messenger/users?dialogId=${encodeURIComponent(dialog.id)}`)
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => {
          if (mine === membersSeq.current) setMembers(data.users);
        })
        // Неизвестный состав не равен пустому: показываем сбой, а не «0 участников».
        .catch(() => {
          if (mine !== membersSeq.current) return;
          setMembers(null);
          setError(t('Не удалось загрузить участников. Закройте настройки и откройте снова.'));
        })
    );
  }, [dialog.id]);

  // Владельца отдаёт im.dialog.get, а не список участников. Без ответа владелец неизвестен,
  // и передать владение не предлагаем.
  const loadOwner = useCallback(
    () =>
      fetch(`/api/messenger/dialogs?dialogId=${encodeURIComponent(dialog.id)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          setOwnerId(Number(data?.dialog?.ownerId) || null);
          const text = String(data?.dialog?.description || '');
          setDescription(text);
          setSavedDescription(text);
          setColor(String(data?.dialog?.color || '').toLowerCase());
        })
        .catch(() => setOwnerId(null)),
    [dialog.id],
  );

  // Сброс только при открытии окна: сверка названия с порталом меняет dialog.title, и
  // сброс по нему стёр бы предупреждение о неизвестном исходе.
  const syncGen = useRef(0);
  const windowGen = useRef(0);
  const titleRef = useRef(dialog.title);
  useEffect(() => {
    titleRef.current = dialog.title;
  }, [dialog.title]);
  useEffect(() => {
    // Открытие и закрытие окна делают начатую сверку названия устаревшей.
    syncGen.current += 1;
    windowGen.current += 1;
    // Закрытые настройки отменяют и незавершённое подтверждение выхода.
    setConfirmLeave(false);
    setNewOwner(null);
    if (!open) return;
    setTitle(titleRef.current);
    setError('');
    setNotice('');
    setQuery('');
    // Состав с прошлого открытия мог устареть: до ответа не предлагаем по нему действий.
    setMembers(null);
    setOwnerId(null);
    void loadMembers();
    void loadOwner();
  }, [open, loadMembers, loadOwner]);

  useEffect(() => {
    const needle = query.trim();
    // Результаты прошлого запроса не должны оставаться нажимаемыми под новым.
    setHits([]);
    if (needle.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/messenger/users?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => setHits(data.users))
        // Сбой поиска не выдаём за «никого не нашлось»; смена запроса отменяет прошлый.
        .catch((failure) => {
          if (failure?.name === 'AbortError') return;
          setHits([]);
          setError(t('Поиск людей не выполнился. Измените запрос, чтобы попробовать ещё раз.'));
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function run(action: () => Promise<void>, failure: string) {
    // Окно могли закрыть и открыть заново, пока шёл запрос: его исход новым окном не правит.
    const win = windowGen.current;
    syncGen.current += 1;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (problem) {
      if (win !== windowGen.current) return;
      // Связь оборвалась (нет ответа или 502): действие могло выполниться. Говорим об этом
      // и перечитываем состав, а про права пишем только при точном отказе портала.
      const unsure =
        !(problem instanceof Error) ||
        !/^\d+$/.test(problem.message) ||
        Number(problem.message) >= 500;
      if (unsure) {
        setError(
          t('Не удалось узнать, выполнилось ли действие. Проверьте состав и название чата.'),
        );
        void loadMembers();
        // Название сверяем с порталом тоже: переименование могло пройти. Ответ применяем,
        // только если после этого не было нового действия.
        const sync = ++syncGen.current;
        void fetch(`/api/messenger/dialogs?dialogId=${encodeURIComponent(dialog.id)}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            const fresh = String(data?.dialog?.title || '');
            if (fresh && sync === syncGen.current) {
              setTitle(fresh);
              onTitleSync(fresh);
            }
          })
          .catch(() => {});
      } else setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set((members || []).map((member) => member.id));
  // Передать владение может владелец, а если владелец ушёл из чата, пусть решит портал:
  // администратор это сможет. Остальным кнопка дала бы только отказ.
  const canHandOver = ownerId !== null && (ownerId === me || !memberIds.has(ownerId));
  // Пока состав неизвестен, кандидатов не предлагаем: среди них были бы и участники.
  const candidates = members ? hits.filter((user) => !memberIds.has(user.id)) : [];

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('Настройки чата')} size="md">
        <div className="space-y-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = title.trim();
              // Пока идёт прошлое действие, второе переименование не уходит: ответы пришли
              // бы в любом порядке и оставили бы не то название.
              if (busy || !next || next === dialog.title) return;
              void run(async () => {
                const win = windowGen.current;
                await post({ dialogId: dialog.id, action: 'rename', title: next });
                // Окно открыли заново, пока шло переименование: обновляем название, не закрывая.
                if (win === windowGen.current) onRenamed(next);
                // Окно открывали заново, могло уйти и другое переименование: порядок ответов
                // не гарантирован, поэтому берём название, которое сейчас у портала.
                else {
                  // Новое действие делает эту сверку устаревшей, как и сверку после сбоя.
                  const sync = ++syncGen.current;
                  void fetch(`/api/messenger/dialogs?dialogId=${encodeURIComponent(dialog.id)}`)
                    .then((response) => (response.ok ? response.json() : null))
                    .then((data) => {
                      if (data?.dialog?.title && sync === syncGen.current)
                        onTitleSync(String(data.dialog.title));
                    })
                    .catch(() => {});
                }
              }, t('Не удалось переименовать: менять название может владелец чата.'));
            }}
          >
            <TextField
              id="chat-settings-title"
              label={t('Название')}
              variant="boxed"
              size="sm"
              className="flex-1"
              value={title}
              maxLength={200}
              onChange={(event) => {
                // Человек правит название сам: поздняя сверка его ввод не перетирает.
                syncGen.current += 1;
                setTitle(event.target.value);
              }}
            />
            <Button type="submit" disabled={busy || !title.trim() || title.trim() === dialog.title}>
              {t('Сохранить')}
            </Button>
          </form>

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = description.trim();
              if (busy || next === savedDescription) return;
              void run(async () => {
                await post({ dialogId: dialog.id, action: 'describe', description: next });
                setSavedDescription(next);
                setNotice(t('Описание сохранено'));
              }, t('Не удалось сохранить описание: это может владелец чата.'));
            }}
          >
            <TextArea
              id="chat-settings-description"
              label={t('Описание')}
              variant="boxed"
              rows={2}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={busy || description.trim() === savedDescription}
              >
                {t('Сохранить описание')}
              </Button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label={t('Цвет чата')} className="flex flex-wrap gap-1.5">
              {/* Цвета это данные портала (im.chat.updateColor знает только эти имена),
                  а не палитра приложения, поэтому они заданы значениями. */}
              {CHAT_COLORS.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  role="radio"
                  aria-checked={color === item.hex}
                  aria-label={t('Цвет {0}', item.name.toLowerCase())}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await post({ dialogId: dialog.id, action: 'color', color: item.name });
                      setColor(item.hex);
                    }, t('Не удалось сменить цвет: на это нужны права в чате.'))
                  }
                  style={{ backgroundColor: item.hex }}
                  className={`size-6 rounded-full border-2 ${
                    color === item.hex ? 'border-ink' : 'border-transparent'
                  }`}
                />
              ))}
            </div>
            <input
              ref={avatarInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              aria-label={t('Аватар чата')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void run(async () => {
                  const avatar = await squareAvatar(file);
                  await post({ dialogId: dialog.id, action: 'avatar', avatar });
                  setNotice(t('Аватар обновлён'));
                }, t('Не удалось сменить аватар: нужна картинка PNG, JPEG или WebP и права в чате.'));
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => avatarInput.current?.click()}
            >
              {t('Сменить аватар')}
            </Button>
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-widest text-ink-soft">
              {t('Участники')}
              {members ? ` (${members.length})` : ''}
            </p>
            <ul className="max-h-48 overflow-y-auto" aria-label={t('Участники чата')}>
              {(members || []).map((member) => (
                <li key={member.id} className="flex min-h-11 items-center gap-3 px-1">
                  <Avatar name={member.name} src={member.avatar} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{member.name}</span>
                  <PresenceDot presence={member.presence} />
                  {member.id === ownerId ? (
                    <span className="shrink-0 text-xs text-ink-soft">{t('владелец')}</span>
                  ) : (
                    canHandOver && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t('Сделать владельцем: {0}', member.name)}
                        title={t('Сделать владельцем')}
                        onClick={() => setNewOwner(member)}
                        className="shrink-0 text-ink-soft hover:text-ink disabled:opacity-30"
                      >
                        <Crown className="size-4" strokeWidth={1.7} />
                      </button>
                    )
                  )}
                  {member.id !== me && member.id !== ownerId && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={t('Исключить {0}', member.name)}
                      onClick={() =>
                        void run(async () => {
                          await post({ dialogId: dialog.id, action: 'remove', userId: member.id });
                          await loadMembers();
                        }, t('Не удалось исключить: на это нужны права в чате.'))
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
              label={t('Добавить участника')}
              placeholder={t('Добавить участника (от двух букв)')}
              size="sm"
              value={query}
              onChange={setQuery}
            />
            {candidates.length > 0 && (
              <ul className="max-h-40 overflow-y-auto" aria-label={t('Кого добавить')}>
                {candidates.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const win = windowGen.current;
                          await post({ dialogId: dialog.id, action: 'add', userIds: [user.id] });
                          // Окно открыли заново: новый поиск человека не стираем.
                          if (win === windowGen.current) setQuery('');
                          await loadMembers();
                        }, t('Не удалось добавить: на это нужны права в чате.'))
                      }
                      className="flex min-h-11 w-full items-center gap-3 rounded-ui px-2 py-1.5 text-left hover:bg-surface-2"
                    >
                      <Avatar name={user.name} src={user.avatar} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{user.name}</span>
                      <span className="text-xs text-ink-soft">{t('Добавить')}</span>
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
          {notice && !error && (
            <p role="status" className="text-sm text-ink-soft">
              {notice}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmLeave(true)}>
              {t('Выйти из чата')}
            </Button>
          </div>
        </div>
      </Modal>
      <AlertDialog
        open={newOwner !== null}
        onCancel={() => setNewOwner(null)}
        onConfirm={() => {
          const target = newOwner;
          setNewOwner(null);
          if (!target) return;
          void run(async () => {
            await post({ dialogId: dialog.id, action: 'owner', userId: target.id });
            await loadOwner();
          }, t('Не удалось передать владение: это может владелец чата или администратор.'));
        }}
        title={t('Передать владение {0}?', newOwner?.name || '')}
        description={t(
          'Новый владелец сможет переименовывать чат и управлять участниками. Вы останетесь обычным участником.',
        )}
        confirmLabel={t('Передать')}
      />
      <AlertDialog
        open={confirmLeave}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          void run(async () => {
            await post({ dialogId: dialog.id, action: 'leave' });
            onLeft();
          }, t('Не удалось выйти из чата.'));
        }}
        title={t('Выйти из чата?')}
        description={t(
          'Чат пропадёт из списка, историю вы больше не увидите, пока вас не добавят снова.',
        )}
        confirmLabel={t('Выйти')}
      />
    </>
  );
}

// Портал хранит аватар квадратом, а фото с телефона весят мегабайты: ужимаем до 256 px
// по центру. Ответ base64 без префикса data:, как ждёт im.chat.updateAvatar.
async function squareAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  canvas
    .getContext('2d')
    ?.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
  bitmap.close();
  return canvas.toDataURL('image/png').split(',')[1] || '';
}
