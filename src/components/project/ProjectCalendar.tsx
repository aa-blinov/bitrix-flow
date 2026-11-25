'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import { Button } from '@/components/monos/Button';
import { Checkbox } from '@/components/monos/Checkbox';
import { IconButton } from '@/components/monos/IconButton';
import { Modal } from '@/components/monos/Modal';
import { TextField } from '@/components/monos/TextField';
import { dateFormat, t } from '@/lib/i18n';
import type { CalendarEvent } from '@/lib/project-life';
import { toLocalInputValue } from '@/lib/utils';
import { useProjectTasks, useTaskModal } from './shared';

const MONTH = dateFormat({ month: 'long', year: 'numeric' });
const WEEKDAY = dateFormat({ weekday: 'short' });
const DAY_TITLE = dateFormat({ weekday: 'long', day: 'numeric', month: 'long' });

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Сетка месяца с понедельника: шесть недель покрывают любой месяц.
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

type Item =
  | { kind: 'task'; id: string; title: string; time: string; overdue: boolean }
  | { kind: 'event'; id: string; title: string; time: string };

/** Вид «Календарь»: сроки задач и встречи из календаря группы портала. */
export default function ProjectCalendar({
  projectId,
  toolbar,
}: {
  projectId: string;
  toolbar: ReactNode;
}) {
  const { tasks, failed } = useProjectTasks(projectId);
  const { open, modal } = useTaskModal(tasks);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsFailed, setEventsFailed] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  // Граница просрочки берётся при открытии вида: в рендере Date.now() нечист.
  const [now] = useState(() => Date.now());
  const grid = useMemo(() => monthGrid(month), [month]);
  const loadEvents = useCallback(async () => {
    const from = dayKey(grid[0]);
    const to = dayKey(grid[grid.length - 1]);
    try {
      const response = await fetch(
        `/api/projects/calendar?projectId=${projectId}&from=${from}&to=${to}`,
      );
      if (!response.ok) throw new Error();
      setEvents((await response.json()).events || []);
      setEventsFailed(false);
    } catch {
      setEventsFailed(true);
    }
  }, [grid, projectId]);
  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const push = (key: string, item: Item) => map.set(key, [...(map.get(key) || []), item]);
    for (const task of tasks || []) {
      if (!task.dueDate) continue;
      const due = new Date(task.dueDate);
      push(dayKey(due), {
        kind: 'task',
        id: task.id,
        title: task.title,
        time: toLocalInputValue(task.dueDate, 'datetime').slice(11, 16),
        overdue: due.getTime() < now,
      });
    }
    for (const event of events)
      push(event.from.slice(0, 10), {
        kind: 'event',
        id: event.id,
        title: event.name,
        time: event.allDay ? '' : event.from.slice(11, 16),
      });
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
  }, [tasks, events, now]);

  const today = dayKey(new Date());
  const shift = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  const itemButton = (item: Item) =>
    item.kind === 'task' ? (
      <button
        key={`t${item.id}`}
        type="button"
        onClick={() => void open(item.id)}
        className={`block w-full truncate rounded-ui px-1 text-left text-xs hover:bg-surface-2 ${
          item.overdue ? 'text-danger-text' : 'text-ink'
        }`}
      >
        {item.time && <span className="text-ink-soft">{item.time} </span>}
        {item.title}
      </button>
    ) : (
      <p
        key={`e${item.id}`}
        className="truncate rounded-ui bg-accent/15 px-1 text-xs text-ink"
        title={item.title}
      >
        {item.time && <span className="text-ink-soft">{item.time} </span>}
        {item.title}
      </p>
    );

  // Дни с делами для узкого экрана: сетка в семь колонок там нечитаема.
  const agenda = grid.filter(
    (day) => day.getMonth() === month.getMonth() && byDay.has(dayKey(day)),
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
        {toolbar}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={t('Предыдущий месяц')}
            variant="ghost"
            size="sm"
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="size-4" strokeWidth={1.7} />
          </IconButton>
          <h2 className="min-w-36 text-center text-sm font-medium text-ink capitalize">
            {MONTH.format(month)}
          </h2>
          <IconButton
            label={t('Следующий месяц')}
            variant="ghost"
            size="sm"
            onClick={() => shift(1)}
          >
            <ChevronRight className="size-4" strokeWidth={1.7} />
          </IconButton>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-4" strokeWidth={1.7} />}
            onClick={() => setCreating(today)}
          >
            {t('Встреча')}
          </Button>
        </div>
      </div>
      {(failed || eventsFailed) && (
        <p role="alert" className="px-4 pb-2 text-sm text-danger-text lg:px-6">
          {failed
            ? t('Не удалось загрузить задачи проекта.')
            : t('Не удалось загрузить встречи проекта.')}
        </p>
      )}
      {!tasks && !failed ? (
        <LoadingState />
      ) : (
        <div className="px-4 pb-6 lg:px-6">
          <div className="grid grid-cols-7 overflow-hidden rounded-ui border border-line max-md:hidden">
            {grid.slice(0, 7).map((day) => (
              <div
                key={`h${day.getDay()}`}
                className="border-b border-line bg-surface px-2 py-1 text-whisper tracking-widest text-ink-faint uppercase"
              >
                {WEEKDAY.format(day)}
              </div>
            ))}
            {grid.map((day) => {
              const key = dayKey(day);
              const items = byDay.get(key) || [];
              const outside = day.getMonth() !== month.getMonth();
              return (
                <div
                  key={key}
                  className={`group min-h-24 border-b border-l border-line p-1 first:border-l-0 [&:nth-child(7n+1)]:border-l-0 ${
                    outside ? 'bg-surface/50' : 'bg-canvas'
                  }`}
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    <span
                      className={`px-1 text-xs ${
                        key === today
                          ? 'rounded-ui bg-ink font-bold text-canvas'
                          : outside
                            ? 'text-ink-faint'
                            : 'text-ink-soft'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      aria-label={t('Встреча {0}', DAY_TITLE.format(day))}
                      onClick={() => setCreating(key)}
                      className="invisible rounded-ui px-1 text-xs text-ink-soft group-hover:visible hover:bg-surface-2 focus-visible:visible"
                    >
                      +
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, 4).map(itemButton)}
                    {items.length > 4 && (
                      <p className="px-1 text-xs text-ink-soft">{t('ещё {0}', items.length - 4)}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="space-y-3 md:hidden">
            {agenda.length === 0 && (
              <p className="py-8 text-center text-sm text-ink-soft">
                {t('В этом месяце сроков и встреч нет')}
              </p>
            )}
            {agenda.map((day) => (
              <section key={dayKey(day)}>
                <h3 className="mb-1 text-xs font-medium text-ink-soft first-letter:uppercase">
                  {DAY_TITLE.format(day)}
                </h3>
                <div className="space-y-1">{(byDay.get(dayKey(day)) || []).map(itemButton)}</div>
              </section>
            ))}
          </div>
        </div>
      )}
      {creating && (
        <EventDialog
          projectId={projectId}
          day={creating}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            void loadEvents();
          }}
        />
      )}
      {modal}
    </div>
  );
}

function EventDialog({
  projectId,
  day,
  onClose,
  onCreated,
}: {
  projectId: string;
  day: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(day);
  const [from, setFrom] = useState('11:00');
  const [to, setTo] = useState('12:00');
  const [allDay, setAllDay] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !date) return;
    if (!allDay && to <= from) {
      setError(t('Встреча должна закончиться позже, чем начнётся.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/projects/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: name.trim(),
          from: allDay ? date : `${date}T${from}`,
          to: allDay ? date : `${date}T${to}`,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.error === 'NO_CALENDAR_SECTION'
            ? t('У проекта в портале нет календаря, куда можно добавить встречу.')
            : data.message || t('Не удалось создать встречу'),
        );
      onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Не удалось создать встречу'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Встреча в календаре проекта')}
      size="sm"
      footer={
        <Button onClick={() => void save()} disabled={!name.trim() || saving}>
          {t('Создать')}
        </Button>
      }
    >
      <div className="space-y-3">
        <TextField
          label={t('Название')}
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t('Дата')}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <Checkbox checked={allDay} onChange={(event) => setAllDay(event.target.checked)}>
          {t('Весь день')}
        </Checkbox>
        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('Начало')}
              type="time"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <TextField
              label={t('Конец')}
              type="time"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
