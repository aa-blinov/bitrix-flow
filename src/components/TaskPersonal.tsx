'use client';

import { useEffect, useState } from 'react';
import { Briefcase, Ellipsis, Star, X } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { IconButton } from '@/components/monos/IconButton';
import { Menu, type MenuItem } from '@/components/monos/Menu';
import { TextField } from '@/components/monos/TextField';
import {
  fetchTaskPersonal,
  setTaskCrm,
  setTaskFavorite,
  setTaskMuted,
  setTaskWatching,
  type TaskPersonal,
} from '@/lib/bitrix24';
import { CRM_TYPE_LABELS, type CrmLink } from '@/lib/crm-links';
import { t } from '@/lib/i18n';

// Последнее известное по задаче: повторно открытая карточка показывает звёздочку и CRM
// сразу, а свежее приходит следом.
const known = new Map<string, TaskPersonal>();

/** Избранное, звук, наблюдение и CRM: у каждого своё, читаем токеном человека. */
export function useTaskPersonal(taskId: string, userId: string) {
  const key = `${userId}:${taskId}`;
  const [state, setState] = useState<{ key: string; value: TaskPersonal } | null>(null);
  const personal = state?.key === key ? state.value : (known.get(key) ?? null);
  const setPersonal = (update: (current: TaskPersonal | null) => TaskPersonal | null) =>
    setState((current) => {
      const value = update(current?.key === key ? current.value : (known.get(key) ?? null));
      if (!value) return current;
      known.set(key, value);
      return { key, value };
    });
  useEffect(() => {
    let cancelled = false;
    const apply = (value: TaskPersonal) => {
      if (cancelled) return;
      known.set(key, value);
      setState({ key, value });
    };
    void fetchTaskPersonal(taskId, userId)
      .then(apply)
      .catch(
        () => !known.has(key) && apply({ favorite: false, muted: false, watching: false, crm: [] }),
      );
    return () => {
      cancelled = true;
    };
  }, [key, taskId, userId]);

  // Правка видна сразу, а при отказе портала откатывается.
  const change = async (patch: Partial<TaskPersonal>, run: () => Promise<void>) => {
    const before = personal;
    setPersonal((current) => (current ? { ...current, ...patch } : current));
    try {
      await run();
      return true;
    } catch {
      setPersonal(() => before);
      return false;
    }
  };
  return { personal, change };
}

type Personal = ReturnType<typeof useTaskPersonal>;

export function FavoriteButton({ taskId, state }: { taskId: string; state: Personal }) {
  const favorite = state.personal?.favorite;
  return (
    <IconButton
      label={favorite ? t('Убрать из избранного') : t('Добавить в избранное')}
      aria-pressed={Boolean(favorite)}
      variant="ghost"
      size="sm"
      disabled={!state.personal}
      onClick={() =>
        void state.change({ favorite: !favorite }, () => setTaskFavorite(taskId, !favorite))
      }
    >
      <Star
        size={14}
        strokeWidth={1.7}
        className={favorite ? 'fill-current text-warning-text' : undefined}
      />
    </IconButton>
  );
}

/** Меню «…» карточки: то, что в портале живёт в «Ещё». */
export function TaskActionsMenu({
  taskId,
  state,
  onWatchChange,
  onDelegate,
  onRemove,
}: {
  taskId: string;
  state: Personal;
  /** Наблюдатели видны в карточке: после переключения их надо перечитать. */
  onWatchChange: () => void;
  onDelegate?: () => void;
  onRemove?: () => void;
}) {
  const personal = state.personal;
  const items: MenuItem[] = [
    {
      value: 'watch',
      label: personal?.watching ? t('Перестать наблюдать') : t('Наблюдать'),
      disabled: !personal,
      onSelect: async () => {
        const next = !personal?.watching;
        if (await state.change({ watching: next }, () => setTaskWatching(taskId, next)))
          onWatchChange();
      },
    },
    {
      value: 'mute',
      label: personal?.muted ? t('Включить уведомления по задаче') : t('Без уведомлений по задаче'),
      disabled: !personal,
      onSelect: () => {
        const next = !personal?.muted;
        void state.change({ muted: next }, () => setTaskMuted(taskId, next));
      },
    },
    ...(onDelegate ? [{ value: 'delegate', label: t('Делегировать…'), onSelect: onDelegate }] : []),
    ...(onRemove
      ? [
          { value: 'sep', label: '', separator: true },
          { value: 'remove', label: t('Удалить задачу'), danger: true, onSelect: onRemove },
        ]
      : []),
  ];
  return (
    <Menu
      portal
      align="end"
      width="auto"
      label={t('Действия с задачей')}
      items={items}
      trigger={
        <IconButton label={t('Действия с задачей')} variant="ghost" size="sm">
          <Ellipsis size={16} strokeWidth={1.7} />
        </IconButton>
      }
    />
  );
}

const crmTypeLabel = (link: CrmLink) =>
  CRM_TYPE_LABELS[link.typeId] ? t(CRM_TYPE_LABELS[link.typeId]) : t('Элемент CRM');

async function fetchCrm(params: string): Promise<CrmLink[]> {
  const response = await fetch(`/api/tasks/crm?${params}`);
  if (!response.ok) throw new Error(t('Не удалось загрузить CRM'));
  return (await response.json()).links || [];
}

/** «Элементы CRM» портала: сделки, контакты, компании и лиды, к которым привязана задача. */
export function TaskCrmLinks({ taskId, state }: { taskId: string; state: Personal }) {
  const codes = state.personal?.crm;
  const list = codes ?? [];
  const [links, setLinks] = useState<CrmLink[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CrmLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  const key = list.join(',');
  useEffect(() => {
    if (!key) {
      setLinks([]);
      return;
    }
    let cancelled = false;
    void fetchCrm(`ids=${encodeURIComponent(key)}`)
      .then((found) => !cancelled && setLinks(found))
      // Без названий привязки всё равно видны: кодом.
      .catch(
        () =>
          !cancelled && setLinks(key.split(',').map((code) => ({ code, typeId: 0, title: '' }))),
      );
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchCrm(`q=${encodeURIComponent(text)}`)
        .then((found) => !cancelled && setResults(found))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const save = async (next: string[], added?: CrmLink) => {
    setError(null);
    if (added) setLinks((current) => [...current, added]);
    const ok = await state.change({ crm: next }, () => setTaskCrm(taskId, next));
    if (!ok) setError(t('Не удалось сохранить привязку к CRM'));
  };

  // Пока настройки задачи грузятся, блок уже стоит на своём месте с выключенным полем:
  // раньше он появлялся через полсекунды и сдвигал вниз всё, что под ним.
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
        <Briefcase size={12} strokeWidth={1.7} /> {t('CRM')}
      </p>
      <div className="space-y-1.5">
        {list.map((code) => {
          const link = links.find((item) => item.code === code) || { code, typeId: 0, title: '' };
          return (
            <div
              key={code}
              className="flex items-center justify-between gap-2 rounded-ui border border-line bg-surface-2 px-2 py-1 text-sm"
            >
              <span className="min-w-0 truncate text-ink">
                <span className="text-ink-soft">{crmTypeLabel(link)}: </span>
                {link.title || code}
              </span>
              <IconButton
                label={t('Отвязать {0}', link.title || code)}
                variant="ghost"
                size="sm"
                onClick={() => void save(list.filter((item) => item !== code))}
              >
                <X size={14} strokeWidth={1.7} />
              </IconButton>
            </div>
          );
        })}
      </div>
      <div className="relative mt-1.5">
        <TextField
          variant="underline"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Привязать сделку, контакт, компанию…')}
          aria-label={t('Привязать элемент CRM')}
          disabled={!codes}
        />
        {query && results.length > 0 && (
          <div className="absolute z-menu mt-1 max-h-48 w-full overflow-y-auto rounded-ui border border-line bg-canvas p-1 shadow-overlay">
            {results
              .filter((candidate) => !list.includes(candidate.code))
              .map((candidate) => (
                <Button
                  key={candidate.code}
                  variant="quiet"
                  size="sm"
                  className="h-auto w-full justify-start px-2 py-1.5 text-left"
                  onClick={() => {
                    setQuery('');
                    void save([...list, candidate.code], candidate);
                  }}
                >
                  {crmTypeLabel(candidate)}: {candidate.title || candidate.code}
                </Button>
              ))}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-danger-text">{error}</p>}
    </div>
  );
}
