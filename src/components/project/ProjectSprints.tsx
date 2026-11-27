'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import LoadingState from '@/components/LoadingState';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Notice } from '@/components/monos/Notice';
import { Progress } from '@/components/monos/Progress';
import { SelectField } from '@/components/monos/SelectField';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { useTaskToasts } from '@/components/monos/toast';
import { dateFormat, t } from '@/lib/i18n';
import {
  SIZES,
  type ScrumBoard,
  type ScrumTask,
  type Sprint,
  type SprintStats,
} from '@/lib/scrum-shared';
import { useKanbanStore } from '@/store/kanban';
import { useTaskModal } from './shared';

type Board = Extract<ScrumBoard, { scrum: true }>;

const DAY = dateFormat({ day: 'numeric', month: 'short' });
// День из строки портала, без сдвига в пояс браузера: 00:00 по Москве иначе становился
// предыдущим днём, и спринт с понедельника показывался с воскресенья.
const portalDay = (value: string) => DAY.format(new Date(`${value.slice(0, 10)}T12:00:00`));
const range = (sprint: Sprint) =>
  sprint.dateStart && sprint.dateEnd
    ? `${portalDay(sprint.dateStart)} – ${portalDay(sprint.dateEnd)}`
    : '';

const STATUS = () => ({
  active: t('Идёт'),
  planned: t('Запланирован'),
  completed: t('Завершён'),
});

/**
 * Спринты скрама Битрикса: бэклог, текущий и следующие спринты, размер задач футболками.
 * Перенос и размер идут выпадашкой, а не перетаскиванием: на телефоне и с клавиатуры
 * выбор надёжнее, а задач в недельном спринте немного.
 */
export default function ProjectSprints({
  projectId,
  toolbar,
}: {
  projectId: string;
  toolbar: ReactNode;
}) {
  const toasts = useTaskToasts();
  const confirm = useConfirm();
  const tasksVersion = useKanbanStore((state) => state.tasksVersion);
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { open, modal } = useTaskModal();

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/scrum?projectId=${projectId}`);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const data = (await response.json()) as ScrumBoard;
      if (!data.scrum) throw new Error('NOT_SCRUM');
      setBoard(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load, tasksVersion]);

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/scrum', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, ...body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || `HTTP_${response.status}`);
      if (done) toasts.saved(done);
      await load();
    } catch (error) {
      toasts.failed(t('Не удалось выполнить действие.'), error);
    } finally {
      setBusy(false);
    }
  }

  const targets = (board?.sprints || [])
    .filter((sprint) => sprint.status !== 'completed')
    .map((sprint) => ({ value: sprint.id, label: sprint.name }));

  const row = (task: ScrumTask, place: string) => (
    <li key={task.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
      <button
        type="button"
        onClick={() => void open(task.id)}
        className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
      >
        <span className={task.done ? 'text-ink-soft line-through' : undefined}>{task.title}</span>
      </button>
      <span className="w-28 truncate text-xs text-ink-soft">
        {task.responsible || t('Не назначен')}
      </span>
      <SelectField
        size="sm"
        className="w-20"
        aria-label={t('Размер задачи {0}', task.title)}
        value={task.size || ''}
        disabled={busy}
        options={[
          { value: '', label: '—' },
          ...SIZES.map((size) => ({ value: size, label: size })),
        ]}
        onChange={(event) =>
          void act({ action: 'setSize', taskId: task.id, size: event.target.value })
        }
      />
      <SelectField
        size="sm"
        className="w-36"
        aria-label={t('Куда перенести {0}', task.title)}
        value={place}
        disabled={busy || task.done}
        options={[{ value: 'backlog', label: t('Бэклог') }, ...targets]}
        onChange={(event) =>
          event.target.value !== place &&
          void act({ action: 'moveTask', taskId: task.id, to: event.target.value })
        }
      />
    </li>
  );

  const capacity = (stats: SprintStats) =>
    stats.people.length ? (
      <ul aria-label={t('Ёмкость по людям')} className="flex flex-wrap gap-2">
        {stats.people.map((person) => (
          <li key={person.id} className="rounded-ui border border-line px-2 py-1 text-xs text-ink">
            {person.name}: {t('очков {0}, задач {1}', person.points, person.tasks)}
            {person.estimateHours ? `, ${t('{0} ч', person.estimateHours)}` : ''}
          </li>
        ))}
      </ul>
    ) : null;

  const sprintCard = (sprint: Sprint) => {
    const { stats } = sprint;
    return (
      <section
        key={sprint.id}
        aria-label={sprint.name}
        className="space-y-3 rounded-ui border border-line bg-surface p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-ink">{sprint.name}</h3>
          <Badge tone={sprint.status === 'active' ? 'accent' : 'neutral'}>
            {STATUS()[sprint.status]}
          </Badge>
          <span className="text-xs text-ink-soft">{range(sprint)}</span>
          <div className="ml-auto flex gap-2">
            {sprint.status === 'planned' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !stats.tasks || board?.sprints.some((s) => s.status === 'active')}
                title={
                  board?.sprints.some((s) => s.status === 'active')
                    ? t('Сначала завершите текущий спринт')
                    : undefined
                }
                onClick={() =>
                  void act({ action: 'startSprint', sprintId: sprint.id }, t('Спринт запущен'))
                }
              >
                {t('Запустить')}
              </Button>
            )}
            {sprint.status === 'active' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('Завершить «{0}»?', sprint.name),
                    description: t(
                      'Незакрытые задачи ({0}) вернутся в бэклог. Это действие в Битриксе, отменить его нельзя.',
                      stats.tasks - stats.done,
                    ),
                    confirmLabel: t('Завершить'),
                  });
                  if (ok) void act({ action: 'completeSprint' }, t('Спринт завершён'));
                }}
              >
                {t('Завершить')}
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Progress
            value={stats.points ? (stats.donePoints / stats.points) * 100 : 0}
            label={t('Прогресс {0}', sprint.name)}
            size="sm"
          />
          <p className="text-xs text-ink-soft">
            {t(
              'Готово задач {0} из {1}, очков {2} из {3}',
              stats.done,
              stats.tasks,
              stats.donePoints,
              stats.points,
            )}
            {stats.unsized ? ` · ${t('без размера: {0}', stats.unsized)}` : ''}
            {stats.estimateHours ? ` · ${t('оценка {0} ч', stats.estimateHours)}` : ''}
          </p>
        </div>
        {capacity(stats)}
        {sprint.tasks.length ? (
          <ul className="divide-y divide-line rounded-ui border border-line">
            {sprint.tasks.map((task) => row(task, sprint.id))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">
            {t('В спринте пока нет задач. Перенесите их из бэклога.')}
          </p>
        )}
      </section>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
        {toolbar}
        <Button
          size="sm"
          className="ml-auto"
          disabled={busy || !board}
          onClick={() => void act({ action: 'createSprint' }, t('Спринт создан'))}
        >
          {t('Новый спринт')}
        </Button>
      </div>
      <div className="mx-auto max-w-4xl space-y-4 px-4 pb-8 lg:px-6">
        {failed ? (
          <Notice tone="danger">
            {t('Не удалось загрузить спринты.')}{' '}
            <Button size="sm" variant="text" onClick={() => void load()}>
              {t('Повторить')}
            </Button>
          </Notice>
        ) : !board ? (
          <LoadingState />
        ) : (
          <>
            {board.sprints.filter((sprint) => sprint.status !== 'completed').map(sprintCard)}
            <section
              aria-label={t('Бэклог')}
              className="space-y-3 rounded-ui border border-line bg-surface p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-ink">{t('Бэклог')}</h3>
                <span className="text-xs text-ink-soft">
                  {t('задач {0}, очков {1}', board.backlogStats.tasks, board.backlogStats.points)}
                  {board.backlogStats.unsized
                    ? ` · ${t('без размера: {0}', board.backlogStats.unsized)}`
                    : ''}
                </span>
              </div>
              {board.backlog.length ? (
                <ul className="divide-y divide-line rounded-ui border border-line">
                  {board.backlog.map((task) => row(task, 'backlog'))}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">{t('Бэклог пуст.')}</p>
              )}
            </section>
          </>
        )}
      </div>
      {modal}
    </div>
  );
}
