'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Pencil } from 'lucide-react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { DateField } from '@/components/monos/DateField';
import { Modal } from '@/components/monos/Modal';
import { SelectField } from '@/components/monos/SelectField';
import { Table, type TableColumn } from '@/components/monos/Table';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import { useKanbanStore } from '@/store/kanban';
import { dateFormat, t } from '@/lib/i18n';

type ProjectStatusRow = {
  projectId: string;
  client: string;
  status: string;
  goal: string;
  state: string;
  step: string;
  stepDeadline: string;
  risk: string;
  ownerId: string;
  updatedAt: string;
};

const STATUS_OPTIONS = ['В работе', 'Ждёт договора', 'Не оформлен', 'Под угрозой', 'Готово'];

// Цвет только ролью: подписи статусов соответствуют палитре приложения.
const STATUS_TONE: Record<string, 'accent' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  'В работе': 'accent',
  'Ждёт договора': 'warning',
  'Не оформлен': 'neutral',
  'Под угрозой': 'danger',
  Готово: 'success',
};

const DEADLINE_FORMAT = dateFormat({ dateStyle: 'medium' });
const UPDATED_FORMAT = dateFormat({ dateStyle: 'medium', timeStyle: 'short' });

type TimelineEntry = {
  memberId: string;
  changes: { field: string; from: string; to: string }[];
  at: string;
};

const EMPTY_FORM: ProjectStatusRow = {
  projectId: '',
  client: '',
  status: '',
  goal: '',
  state: '',
  step: '',
  stepDeadline: '',
  risk: '',
  ownerId: '',
  updatedAt: '',
};

export default function ProjectStatusPage() {
  const memberId = useKanbanStore((state) => state.memberId);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  const loadProjects = useKanbanStore((state) => state.loadProjects);
  const [statuses, setStatuses] = useState<ProjectStatusRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ProjectStatusRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [timelineFor, setTimelineFor] = useState<ProjectStatusRow | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/projects/status', {
        headers: { 'X-Member-Id': memberId },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || t('Не удалось получить статусы'));
      setStatuses(data.statuses || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Не удалось получить статусы'));
    } finally {
      setIsLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void load();
    void loadProjects();
  }, [load, loadProjects]);

  const openTimeline = useCallback(
    async (row: ProjectStatusRow) => {
      if (!memberId) return;
      setSaveError('');
      setTimelineFor(row);
      setTimelineLoading(true);
      try {
        const response = await fetch(
          `/api/projects/status?history_project_id=${encodeURIComponent(row.projectId)}`,
          { headers: { 'X-Member-Id': memberId } },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(t('Не удалось получить историю'));
        setTimeline(data.timeline || []);
      } catch {
        // Ошибка видна в интерфейсе, а не «правок не было»: пустой таймлайн вводит в заблуждение.
        setSaveError(t('Не удалось загрузить историю статуса'));
        setTimeline([]);
        setTimeline([]);
      } finally {
        setTimelineLoading(false);
      }
    },
    [memberId],
  );

  const projectName = useCallback(
    (projectId: string) => {
      const project = projects.find((item) => String(item.id) === projectId);
      return project ? project.name || project.id : `${t('Проект')} #${projectId}`;
    },
    [projects],
  );

  const ownerName = (ownerId: string) => {
    const user = users.find((item) => String(item.id) === ownerId);
    return user ? user.name : '';
  };

  const memberName = (id: string) => ownerName(id) || t('Пользователь') + ' #' + id;

  const save = useCallback(async () => {
    if (!editing || !memberId) return;
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/projects/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Member-Id': memberId },
        body: JSON.stringify({
          projectId: editing.projectId,
          client: editing.client,
          status: editing.status,
          goal: editing.goal,
          state: editing.state,
          step: editing.step,
          stepDeadline: editing.stepDeadline,
          risk: editing.risk,
          ownerId: editing.ownerId,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || t('Не удалось сохранить статус'));
      }
      const data = await response.json();
      const saved = data.status as ProjectStatusRow;
      // Правка сразу попадает в таблицу и в Битрикс: зеркало уже записано.
      setStatuses((current) => [
        ...current.filter((row) => row.projectId !== saved.projectId),
        saved,
      ]);
      setEditing(null);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : t('Не удалось сохранить статус'));
    } finally {
      setSaving(false);
    }
  }, [editing, memberId]);

  const projectKey = useMemo(
    () => new Map(projects.map((project) => [String(project.id), project.name])),
    [projects],
  );
  const rows = useMemo(
    () =>
      [...statuses].sort((a, b) =>
        (projectKey.get(a.projectId) || a.projectId).localeCompare(
          projectKey.get(b.projectId) || b.projectId,
          'ru',
        ),
      ),
    [statuses, projectKey],
  );

  const asRow = (row: Record<string, unknown>) => row as unknown as ProjectStatusRow;

  const columns: TableColumn[] = [
    {
      key: 'client',
      label: t('Клиент'),
      cell: (row) => <span className="font-medium">{asRow(row).client || '—'}</span>,
    },
    {
      key: 'project',
      label: t('Проект'),
      cell: (row) => projectName(String(asRow(row).projectId)),
    },
    {
      key: 'status',
      label: t('Статус'),
      cell: (row) => {
        const item = asRow(row);
        if (!item.status) return <Badge tone="neutral">{t('Не заведён')}</Badge>;
        return <Badge tone={STATUS_TONE[item.status] || 'neutral'}>{item.status}</Badge>;
      },
    },
    {
      key: 'goal',
      label: t('Цель'),
      cell: (row) => <span className="line-clamp-2 text-ink-soft">{asRow(row).goal || '—'}</span>,
    },
    {
      key: 'step',
      label: t('Ближайший шаг'),
      cell: (row) => {
        const item = asRow(row);
        return (
          <div className="min-w-44">
            <p className="line-clamp-2 text-ink-soft">{item.step || '—'}</p>
            {item.stepDeadline && (
              <p className="text-xs text-ink-faint">
                {DEADLINE_FORMAT.format(new Date(item.stepDeadline))}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'risk',
      label: t('Главный риск'),
      cell: (row) => <span className="line-clamp-2 text-ink-soft">{asRow(row).risk || '—'}</span>,
    },
    {
      key: 'owner',
      label: t('Ответственный'),
      cell: (row) => ownerName(String(asRow(row).ownerId)) || '—',
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="quiet"
            size="sm"
            aria-label={t('История')}
            onClick={() => void openTimeline(asRow(row))}
          >
            <Clock3 className="size-4" strokeWidth={1.7} />
          </Button>
          <Button
            variant="quiet"
            size="sm"
            aria-label={t('Правка')}
            onClick={() => {
              setSaveError('');
              setEditing({ ...asRow(row) });
            }}
          >
            <Pencil className="size-4" strokeWidth={1.7} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title={t('Статусы проектов')}
        description={t('Статус, цель, шаг и риск по каждому проекту — как в таблице прода')}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setSaveError('');
              setEditing({ ...EMPTY_FORM });
            }}
          >
            {t('Добавить статус')}
          </Button>
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <Card>
          <p className="p-4 text-sm text-danger-text">{error}</p>
        </Card>
      ) : (
        <Card padding="none">
          <Table
            columns={columns}
            rows={rows as unknown as Record<string, unknown>[]}
            rowKey={(row) => asRow(row).projectId}
            emptyLabel={t('Статусы ещё не заведены — добавьте первый')}
          />
        </Card>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.projectId ? projectName(editing.projectId) : t('Новый статус проекта')}
        // Форма из десяти полей в две колонки: в узком окне она не влезала
        // в экран без прокрутки.
        size="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            {saveError && <p className="mr-auto text-sm text-danger-text">{saveError}</p>}
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('Отмена')}
            </Button>
            <Button onClick={() => void save()} disabled={saving || !editing?.projectId}>
              {t('Сохранить')}
            </Button>
          </div>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t('Проект')}
              options={projects.map((project) => ({
                value: String(project.id),
                label: project.name || `${t('Проект')} #${project.id}`,
              }))}
              value={editing.projectId}
              onChange={(event) => setEditing({ ...editing, projectId: event.target.value })}
            />
            <TextField
              label={t('Клиент')}
              value={editing.client}
              onChange={(value) => setEditing({ ...editing, client: value.target.value })}
            />
            <SelectField
              label={t('Статус')}
              options={STATUS_OPTIONS.map((option) => ({ value: option, label: option }))}
              value={editing.status}
              placeholder={t('Выберите статус')}
              onChange={(event) => setEditing({ ...editing, status: event.target.value })}
            />
            <SelectField
              label={t('Ответственный сейчас')}
              options={users.map((user) => ({ value: String(user.id), label: user.name }))}
              value={editing.ownerId}
              placeholder={t('Выберите ответственного')}
              onChange={(event) => setEditing({ ...editing, ownerId: event.target.value })}
            />
            <TextArea
              label={t('Цель')}
              value={editing.goal}
              rows={3}
              onChange={(value) => setEditing({ ...editing, goal: value.target.value })}
            />
            <TextArea
              label={t('Текущее состояние')}
              value={editing.state}
              rows={3}
              onChange={(value) => setEditing({ ...editing, state: value.target.value })}
            />
            <TextArea
              label={t('Ближайший шаг')}
              value={editing.step}
              rows={3}
              onChange={(value) => setEditing({ ...editing, step: value.target.value })}
            />
            <DateField
              label={t('Срок шага')}
              value={editing.stepDeadline}
              onChange={(value) => setEditing({ ...editing, stepDeadline: value })}
            />
            <TextArea
              label={t('Главный риск')}
              value={editing.risk}
              rows={3}
              onChange={(value) => setEditing({ ...editing, risk: value.target.value })}
            />
            {editing.updatedAt && (
              <p className="self-end text-xs text-ink-faint">
                {t('Обновлено:')} {UPDATED_FORMAT.format(new Date(editing.updatedAt))}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={timelineFor !== null}
        onClose={() => setTimelineFor(null)}
        title={timelineFor ? `${t('История статуса')} — ${projectName(timelineFor.projectId)}` : ''}
        size="md"
      >
        {timelineLoading ? (
          <LoadingState />
        ) : saveError ? (
          <p className="text-sm text-danger-text">{saveError}</p>
        ) : timeline.length ? (
          <ol className="flex flex-col gap-3">
            {/* Новые записи сверху — вне зависимости от порядка ответа API. */}
            {[...timeline]
              .sort((a, b) => +new Date(b.at) - +new Date(a.at))
              .map((entry, index) => (
                <li key={index} className="border-l-2 border-line pl-3">
                  <p className="text-xs text-ink-faint">
                    {UPDATED_FORMAT.format(new Date(entry.at))} — {memberName(entry.memberId)}
                  </p>
                  <ul className="mt-1 text-sm">
                    {entry.changes.map((change, changeIndex) => (
                      <li key={changeIndex}>
                        <span className="font-medium">{change.field}: </span>
                        {change.from && <span className="text-ink-soft">{change.from} → </span>}
                        <span className="text-ink">{change.to}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-soft">{t('Правок пока не было')}</p>
        )}
      </Modal>
    </div>
  );
}
