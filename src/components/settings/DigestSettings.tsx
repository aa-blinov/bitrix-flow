'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { useTaskToasts } from '@/components/monos/toast';
import LoadingState from '@/components/LoadingState';
import { t } from '@/lib/i18n';
import { useKanbanStore } from '@/store/kanban';

type Config = { dialogId: string; weekday: number; hour: number; source: 'settings' | 'env' };
type Mode = 'off' | 'person' | 'chat';

const modeOf = (dialogId: string): Mode =>
  !dialogId ? 'off' : dialogId.startsWith('chat') ? 'chat' : 'person';

// Порядок с понедельника, значения как у Date.getDay: 0 это воскресенье.
const WEEKDAYS = () => [
  { value: '1', label: t('Понедельник') },
  { value: '2', label: t('Вторник') },
  { value: '3', label: t('Среда') },
  { value: '4', label: t('Четверг') },
  { value: '5', label: t('Пятница') },
  { value: '6', label: t('Суббота') },
  { value: '0', label: t('Воскресенье') },
];
const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

export default function DigestSettings() {
  const toasts = useTaskToasts();
  const users = useKanbanStore((state) => state.users);
  const [config, setConfig] = useState<Config | null>(null);
  const [preview, setPreview] = useState('');
  const [mode, setMode] = useState<Mode>('off');
  const [person, setPerson] = useState('');
  const [chat, setChat] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [hour, setHour] = useState('9');
  const [forbidden, setForbidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/admin/digest');
      if (response.status === 403) return setForbidden(true);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const data = await response.json();
      const saved: Config = data.config;
      setConfig(saved);
      setPreview(data.preview || '');
      setMode(modeOf(saved.dialogId));
      setPerson(modeOf(saved.dialogId) === 'person' ? saved.dialogId : '');
      setChat(modeOf(saved.dialogId) === 'chat' ? saved.dialogId.slice(4) : '');
      setWeekday(String(saved.weekday));
      setHour(String(saved.hour));
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(
    () =>
      [...users]
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((user) => ({ value: String(user.id), label: user.name })),
    [users],
  );
  const chatValid = /^\d+$/.test(chat.trim());
  const dialogId =
    mode === 'person' ? person : mode === 'chat' && chatValid ? `chat${chat.trim()}` : '';
  const incomplete = (mode === 'person' && !person) || (mode === 'chat' && !chatValid);

  async function save() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/digest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dialogId, weekday: Number(weekday), hour: Number(hour) }),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      setConfig((await response.json()).config);
      toasts.saved(t('Настройки сводки сохранены'));
    } catch (error) {
      toasts.failed(t('Не удалось сохранить настройки'), error);
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    setBusy(true);
    try {
      const response = await fetch('/api/digest', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.results?.some((result: { ok: boolean }) => result.ok))
        throw new Error(data?.error || `HTTP_${response.status}`);
      toasts.saved(t('Сводка отправлена'));
    } catch (error) {
      toasts.failed(t('Сводка не отправилась'), error);
    } finally {
      setBusy(false);
    }
  }

  // Отправка идёт по сохранённым настройкам: несохранённый выбор на экране ещё не действует.
  const dirty =
    config !== null &&
    (dialogId !== config.dialogId ||
      Number(weekday) !== config.weekday ||
      Number(hour) !== config.hour);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{t('Недельная сводка')}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {t(
            'Раз в неделю BitrixFlow сам пишет в чат Битрикса, где и у кого просрочки, чтобы не открывать отчёты',
          )}
        </p>
      </div>
      {forbidden ? (
        <Notice tone="danger">{t('Раздел доступен только администраторам.')}</Notice>
      ) : !config && loadFailed ? (
        <Notice tone="danger">
          {t('Не удалось загрузить настройки.')}{' '}
          <Button size="sm" variant="text" onClick={() => void load()}>
            {t('Повторить')}
          </Button>
        </Notice>
      ) : !config ? (
        <LoadingState label={t('Загрузка…')} />
      ) : (
        <>
          {config.source === 'env' && (
            <Notice tone="info">
              {t(
                'Сейчас действуют настройки из .env на сервере. После сохранения здесь они перестанут учитываться.',
              )}
            </Notice>
          )}
          <Card className="space-y-5">
            {/* У переключателя подпись только для чтения с экрана: видимую ставим сами. */}
            <div className="space-y-1.5">
              <p className="text-xs tracking-widest text-ink-soft uppercase">{t('Куда слать')}</p>
              <SegmentedControl
                label={t('Куда слать')}
                value={mode}
                onChange={(value) => setMode(value as Mode)}
                options={[
                  { value: 'off', label: t('Не слать') },
                  { value: 'person', label: t('Человеку') },
                  { value: 'chat', label: t('В групповой чат') },
                ]}
              />
            </div>
            {mode === 'person' && (
              <SelectField
                label={t('Получатель')}
                placeholder={t('Выберите человека')}
                value={person}
                options={people}
                onChange={(event) => setPerson(event.target.value)}
              />
            )}
            {mode === 'chat' && (
              <TextField
                label={t('Номер чата')}
                hint={t('Число из адреса чата в Битриксе: для chat1234 введите 1234')}
                inputMode="numeric"
                value={chat}
                error={chat && !chatValid ? t('Нужны только цифры') : undefined}
                onChange={(event) => setChat(event.target.value)}
              />
            )}
            {mode !== 'off' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label={t('День')}
                  value={weekday}
                  options={WEEKDAYS()}
                  onChange={(event) => setWeekday(event.target.value)}
                />
                <SelectField
                  label={t('Время по Москве')}
                  value={hour}
                  options={HOURS}
                  onChange={(event) => setHour(event.target.value)}
                />
              </div>
            )}
            <p className="text-xs text-ink-soft">
              {t(
                'Сообщение уходит от имени того, кто устанавливал приложение на портал. Если это вы, не выбирайте себя: в чат с самим собой оно не придёт.',
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || incomplete || !dirty} onClick={() => void save()}>
                {t('Сохранить')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || dirty || !config.dialogId}
                title={dirty ? t('Сначала сохраните настройки') : undefined}
                onClick={() => void sendNow()}
              >
                {t('Отправить сейчас')}
              </Button>
            </div>
          </Card>
          {preview && (
            <Card className="space-y-2">
              <h3 className="text-xs uppercase tracking-widest text-ink-soft">
                {t('Как выглядит сводка сейчас')}
              </h3>
              <pre className="font-ui text-xs whitespace-pre-wrap text-ink">{preview}</pre>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
