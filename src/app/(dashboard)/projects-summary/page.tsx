'use client';

import Link from 'next/link';
import { useKanbanStore } from '@/store/kanban';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Progress } from '@/components/monos/Progress';
import { SelectField } from '@/components/monos/SelectField';
import { Table, type TableColumn } from '@/components/monos/Table';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl, toolbarSelect } from '@/components/monos/toolbar';
import { useSSE } from '@/hooks/useSSE';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { pluralRu } from '@/lib/utils';

type ProjectSummary = {
  id: string;
  name: string;
  membersCount: number;
  taskCount: number;
  parentTaskCount: number;
  leafTaskCount: number;
  completed: number;
  inProgress: number;
  overdue: number;
  noDeadline: number;
  comments: number;
  plannedHours: number;
  actualHours: number;
  progress: number;
  changedAt: string | null;
};

const TASK_FORMS = ['задачи', 'задач', 'задач'] as const; // «из 1 задачи, из 5 задач»
const messages = (count: number) =>
  `${count} ${pluralRu(count, ['сообщение', 'сообщения', 'сообщений'])}`;

const CHANGED_FORMAT = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const HOURS_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const hours = (value: number) => `${HOURS_FORMAT.format(value)} ч`;

export default function ProjectsSummaryPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [calculatedAt, setCalculatedAt] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateField, setDateField] = useState<'changed' | 'created'>('changed');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef({ fromDate, toDate, dateField });
  filtersRef.current = { fromDate, toDate, dateField };

  // member_id берём из стора: в localStorage он появляется только после
  // OAuth-редиректа, и на свежем устройстве страница зависала в «Загрузка…»,
  // потому что выход по !memberId не снимал флаг.
  const memberId = useKanbanStore((state) => state.memberId);
  const load = useCallback(
    async (force = false, silent = false) => {
      if (!memberId) {
        setIsLoading(false);
        return;
      }
      if (!silent) setIsLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (force) params.set('refresh', '1');
        if (filtersRef.current.fromDate) params.set('from', filtersRef.current.fromDate);
        if (filtersRef.current.toDate) params.set('to', filtersRef.current.toDate);
        params.set('date_field', filtersRef.current.dateField);
        const response = await fetch(`/api/projects/summary?${params}`, {
          headers: { 'X-Member-Id': memberId },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Не удалось получить сводку');
        setProjects(data.projects || []);
        setCalculatedAt(data.calculatedAt || '');
        if (data.refreshing) {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => {
            void load(false, true);
          }, 3000);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Не удалось получить сводку');
      } finally {
        setIsLoading(false);
      }
    },
    [memberId],
  );

  useEffect(() => {
    void load();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [load]);
  const refreshFromEvent = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void load(false, true);
    }, 1200);
  }, [load]);
  useSSE(memberId, refreshFromEvent);
  const shown = useMemo(
    () =>
      projects.filter((project) =>
        project.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')),
      ),
    [projects, query],
  );

  const statusBadges = (project: ProjectSummary) => (
    <div className="flex flex-wrap gap-1">
      {project.overdue > 0 ? (
        <Link href={`/projects/${project.id}?view=grid&status=overdue`}>
          <Badge tone="danger">Просрочено: {project.overdue}</Badge>
        </Link>
      ) : null}
      {project.inProgress > 0 ? (
        <Link href={`/projects/${project.id}?view=grid&status=active`}>
          <Badge tone="accent">{project.inProgress} в работе</Badge>
        </Link>
      ) : null}
      {project.noDeadline > 0 ? (
        <Link href={`/projects/${project.id}?view=grid&status=no_deadline`}>
          <Badge tone="neutral">{project.noDeadline} без срока</Badge>
        </Link>
      ) : null}
    </div>
  );

  const columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Проект',
      cell: (row) => {
        const project = row as unknown as ProjectSummary;
        return (
          <>
            <Link className="font-medium hover:underline" href={`/projects/${project.id}`}>
              {project.name}
            </Link>
            <div className="mt-1 flex gap-2 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1">
                <Users size={12} strokeWidth={1.7} />
                {project.membersCount}
              </span>
              {project.comments > 0 ? <span>{messages(project.comments)}</span> : null}
            </div>
          </>
        );
      },
    },
    {
      key: 'hours',
      label: 'Часы',
      cell: (row) => {
        const project = row as unknown as ProjectSummary;
        return (
          <>
            <div className="text-sm tabular-nums">
              <span className="font-medium">{hours(project.plannedHours)}</span>
              <span className="mx-1 text-ink-soft">/</span>
              <span className="font-medium">{hours(project.actualHours)}</span>
            </div>
            <div className="text-xs text-ink-soft">план / факт</div>
          </>
        );
      },
    },
    {
      key: 'progress',
      label: 'Прогресс',
      cell: (row) => {
        const project = row as unknown as ProjectSummary;
        return (
          <>
            <div className="flex items-center gap-2">
              <Progress
                value={project.progress}
                label={`Прогресс проекта «${project.name}»`}
                tone={project.progress === 100 ? 'success' : 'accent'}
                className="w-16"
              />
              <span className="text-xs font-medium tabular-nums">{project.progress}%</span>
            </div>
            <div className="text-xs text-ink-soft">
              {project.completed} из {project.leafTaskCount} выполнено
            </div>
          </>
        );
      },
    },
    {
      key: 'tasks',
      label: 'Задачи',
      cell: (row) => {
        const project = row as unknown as ProjectSummary;
        return (
          <>
            <div className="text-sm">
              <span className="font-medium tabular-nums">{project.taskCount}</span>
              <span className="ml-1 text-ink-soft">всего</span>
            </div>
            {/* Тут стояло «N исполнителей», хотя выводилось число задач без
                подзадач. Показываем то, что есть на самом деле. */}
            {project.parentTaskCount > 0 ? (
              <div className="text-xs text-ink-soft">{project.parentTaskCount} с подзадачами</div>
            ) : null}
          </>
        );
      },
    },
    {
      key: 'status',
      label: 'Статус',
      cell: (row) => statusBadges(row as unknown as ProjectSummary),
    },
    {
      key: 'changedAt',
      label: 'Изменения',
      cell: (row) => {
        const project = row as unknown as ProjectSummary;
        return (
          <span className="text-xs text-ink-soft">
            {project.changedAt ? CHANGED_FORMAT.format(new Date(project.changedAt)) : 'Нет задач'}
          </span>
        );
      },
    },
  ];

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader
        title="Сводка по проектам"
        description="План, факт и операционный статус по задачам проектов"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load(true)}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? 'animate-spin' : ''} size={14} strokeWidth={1.7} />{' '}
            Обновить
          </Button>
        }
      />
      <div className="space-y-3 px-4 py-4 lg:px-6">
        <Card padding="none">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <TextField
              variant="boxed"
              size="sm"
              className={`${toolbarControl} w-full sm:w-56 lg:w-auto lg:min-w-64 lg:flex-1`}
              placeholder="Найти проект…"
              aria-label="Найти проект"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex items-center gap-1.5 text-sm">
              <span className="shrink-0 text-ink-soft">По дате:</span>
              <SelectField
                size="sm"
                variant="boxed"
                className={`${toolbarSelect} w-32`}
                value={dateField}
                onChange={(event) => setDateField(event.target.value as 'changed' | 'created')}
                options={[
                  { value: 'changed', label: 'изменения' },
                  { value: 'created', label: 'создания' },
                ]}
                aria-label="Считать по дате"
              />
            </div>
            <div className="flex w-full flex-col gap-1 text-sm sm:w-auto sm:flex-row sm:items-center sm:gap-1.5">
              <span className="shrink-0 text-ink-soft">Период:</span>
              <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 sm:w-auto">
                <label htmlFor="summary-date-from" className="text-ink-soft">
                  с
                </label>
                <TextField
                  id="summary-date-from"
                  type="date"
                  variant="boxed"
                  size="sm"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className={`${toolbarControl} w-full min-w-0 sm:w-36`}
                  aria-label="Начальная дата периода"
                />
                <label htmlFor="summary-date-to" className="text-ink-soft">
                  по
                </label>
                <TextField
                  id="summary-date-to"
                  type="date"
                  variant="boxed"
                  size="sm"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className={`${toolbarControl} w-full min-w-0 sm:w-36`}
                  aria-label="Конечная дата периода"
                />
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className={toolbarControl}
              onClick={() => void load(false)}
              disabled={isLoading}
            >
              Применить
            </Button>
            {/* Сброс периода ничего не удаляет — красный тут пугал зря. */}
            <Button
              variant="quiet"
              size="sm"
              className={toolbarControl}
              disabled={!fromDate && !toDate}
              onClick={() => {
                setFromDate('');
                setToDate('');
                setTimeout(() => void load(false), 0);
              }}
            >
              Сбросить
            </Button>
          </div>
          {error ? (
            <p className="p-6 text-sm text-danger-text">{error}</p>
          ) : isLoading ? (
            <LoadingState className="min-h-72 bg-transparent" />
          ) : (
            <>
              <div className="divide-y divide-line md:hidden">
                {shown.map((project) => (
                  <article key={project.id} className="space-y-3 py-3">
                    <div>
                      <Link
                        className="font-medium leading-snug hover:underline"
                        href={`/projects/${project.id}`}
                      >
                        {project.name}
                      </Link>
                      <div className="mt-1 flex gap-2 text-xs text-ink-soft">
                        <span className="inline-flex items-center gap-1">
                          <Users size={12} strokeWidth={1.7} />
                          {project.membersCount}
                        </span>
                        {project.comments > 0 ? <span>{messages(project.comments)}</span> : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="font-medium">
                          {hours(project.plannedHours)} / {hours(project.actualHours)}
                        </p>
                        <p className="text-xs text-ink-soft">план / факт</p>
                      </div>
                      <div>
                        <p className="font-medium">{project.progress}% выполнено</p>
                        <p className="text-xs text-ink-soft">
                          {project.completed} из {project.leafTaskCount}{' '}
                          {pluralRu(project.leafTaskCount, TASK_FORMS)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">{statusBadges(project)}</div>
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
                <Table
                  columns={columns}
                  rows={shown as unknown as Record<string, unknown>[]}
                  rowKey={(row) => (row as unknown as ProjectSummary).id}
                />
              </div>
            </>
          )}
        </Card>
        {calculatedAt ? (
          <p className="text-xs text-ink-soft">
            Рассчитано:{' '}
            {new Intl.DateTimeFormat('ru-RU', { timeStyle: 'medium' }).format(
              new Date(calculatedAt),
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}
