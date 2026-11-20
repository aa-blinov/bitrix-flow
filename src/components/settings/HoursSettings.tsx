'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Chip } from '@/components/monos/Chip';
import { Notice } from '@/components/monos/Notice';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { useTaskToasts } from '@/components/monos/toast';
import LoadingState from '@/components/LoadingState';
import { t } from '@/lib/i18n';
import { useKanbanStore } from '@/store/kanban';

type Settings = {
  excludedUserIds: string[];
  dailyHours: number;
  threshold: number;
  perUser: Record<string, number>;
  source: 'settings' | 'env';
};

const validHours = (value: string) => {
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) && number > 0 && number <= 24;
};

export default function HoursSettings() {
  const toasts = useTaskToasts();
  const users = useKanbanStore((state) => state.users);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [daily, setDaily] = useState('8');
  const [threshold, setThreshold] = useState('80');
  const [perUser, setPerUser] = useState<[string, string][]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (settings: Settings) => {
    setSaved(settings);
    setExcluded(settings.excludedUserIds);
    setDaily(String(settings.dailyHours));
    setThreshold(String(Math.round(settings.threshold * 100)));
    setPerUser(Object.entries(settings.perUser).map(([id, hours]) => [id, String(hours)]));
  };

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/admin/hours-settings');
      if (response.status === 403) return setForbidden(true);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      apply((await response.json()).settings);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useMemo(() => {
    const names = new Map(users.map((user) => [String(user.id), user.name]));
    return (id: string) => names.get(id) || `#${id}`;
  }, [users]);
  // В выпадашке только те, кого ещё нет в списке: второй раз одного человека не добавить.
  const choices = (taken: string[]) =>
    [...users]
      .filter((user) => !taken.includes(String(user.id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((user) => ({ value: String(user.id), label: user.name }));

  const thresholdNumber = Number(threshold);
  const thresholdValid =
    Number.isInteger(thresholdNumber) && thresholdNumber > 0 && thresholdNumber <= 100;
  const valid =
    validHours(daily) && thresholdValid && perUser.every(([, hours]) => validHours(hours));

  async function save() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/hours-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          excludedUserIds: excluded,
          dailyHours: Number(daily.replace(',', '.')),
          threshold: thresholdNumber / 100,
          perUser: Object.fromEntries(
            perUser.map(([id, hours]) => [id, Number(hours.replace(',', '.'))]),
          ),
        }),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      apply((await response.json()).settings);
      toasts.saved(t('Настройки часов сохранены'));
    } catch (error) {
      toasts.failed(t('Не удалось сохранить настройки'), error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{t('Учёт часов')}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {t('Кого не считать в часах и какая норма в отчёте «Списание часов»')}
        </p>
      </div>
      {forbidden ? (
        <Notice tone="danger">{t('Раздел доступен только администраторам.')}</Notice>
      ) : !saved && loadFailed ? (
        <Notice tone="danger">
          {t('Не удалось загрузить настройки.')}{' '}
          <Button size="sm" variant="text" onClick={() => void load()}>
            {t('Повторить')}
          </Button>
        </Notice>
      ) : !saved ? (
        <LoadingState label={t('Загрузка…')} />
      ) : (
        <>
          {saved.source === 'env' && (
            <Notice tone="info">
              {t(
                'Служебные учётки сейчас берутся из .env на сервере. После сохранения здесь они перестанут учитываться.',
              )}
            </Notice>
          )}
          <Card className="space-y-5">
            <div className="space-y-2">
              <h3 className="text-xs tracking-widest text-ink-soft uppercase">
                {t('Служебные учётки')}
              </h3>
              <p className="text-xs text-ink-soft">
                {t(
                  'Их списания не входят ни в аналитику часов, ни в отчёты, ни в дашборды: например, бот или общий аккаунт.',
                )}
              </p>
              {excluded.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {excluded.map((id) => (
                    <Chip
                      key={id}
                      removable
                      removeLabel={t('Убрать {0}', nameOf(id))}
                      onRemove={() => setExcluded(excluded.filter((item) => item !== id))}
                    >
                      {nameOf(id)}
                    </Chip>
                  ))}
                </div>
              )}
              <SelectField
                className="max-w-xs"
                placeholder={t('Добавить учётку')}
                aria-label={t('Добавить учётку')}
                value=""
                options={choices(excluded)}
                onChange={(event) =>
                  event.target.value && setExcluded([...excluded, event.target.value])
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('Норма в будний день, ч')}
                inputMode="decimal"
                value={daily}
                error={validHours(daily) ? undefined : t('От 0 до 24 часов')}
                onChange={(event) => setDaily(event.target.value)}
              />
              <TextField
                label={t('Порог «ниже нормы», %')}
                hint={t('Человек попадает в список, если списал меньше этой доли нормы')}
                inputMode="numeric"
                value={threshold}
                error={thresholdValid ? undefined : t('Целое число от 1 до 100')}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-xs tracking-widest text-ink-soft uppercase">{t('Своя норма')}</h3>
              <p className="text-xs text-ink-soft">
                {t('Для людей с неполным днём: часов в будний день вместо общей нормы.')}
              </p>
              {perUser.map(([id, hours], index) => (
                <div key={id} className="flex items-end gap-2">
                  <span className="min-w-0 flex-1 truncate pb-2 text-sm text-ink">
                    {nameOf(id)}
                  </span>
                  <TextField
                    className="w-24"
                    aria-label={t('Норма для {0}, ч', nameOf(id))}
                    inputMode="decimal"
                    value={hours}
                    error={validHours(hours) ? undefined : t('От 0 до 24')}
                    onChange={(event) =>
                      setPerUser(
                        perUser.map((row, at) => (at === index ? [id, event.target.value] : row)),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="text"
                    onClick={() => setPerUser(perUser.filter((_, at) => at !== index))}
                  >
                    {t('Убрать')}
                  </Button>
                </div>
              ))}
              <SelectField
                className="max-w-xs"
                placeholder={t('Добавить человека')}
                aria-label={t('Добавить человека')}
                value=""
                options={choices(perUser.map(([id]) => id))}
                onChange={(event) =>
                  event.target.value && setPerUser([...perUser, [event.target.value, '4']])
                }
              />
            </div>

            <Button disabled={busy || !valid} onClick={() => void save()}>
              {t('Сохранить')}
            </Button>
          </Card>
        </>
      )}
    </section>
  );
}
