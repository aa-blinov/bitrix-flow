'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { DateField } from '@/components/monos/DateField';
import { Modal } from '@/components/monos/Modal';
import { useConfirm } from '@/components/monos/confirm-dialog';
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editing, setEditing] = useState<ProjectStatusRow | null>(null);
  const confirm = useConfirm();

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

  const projectName = useCallback(
    (projectId: string) => {
      const project = projects.find((item) => String(item.id) === projectId);
      return project ? project.name || project.id : `${t('Проект')} #${projectId}`;
    },
    [projects],
  );

  // Запись сносится и в зеркале, и в списке портала, вернуть её нельзя: спрашиваем
  // тем же диалогом, что и остальные удаления. Подсветка кнопки «нажмите ещё раз»
  // подтверждением не читалась.
  const removeStatus = useCallback(
    async (row: ProjectStatusRow) => {
      if (!memberId) return;
      const ok = await confirm({
        title: t('Удалить статус проекта «{0}»?', projectName(row.projectId)),
        description: t(
          'Запись пропадёт из списка в Битрикс24 вместе с историей правок. Сам проект и его задачи не трогаются.',
        ),
        confirmLabel: t('Удалить'),
        destructive: true,
      });
      if (!ok) return;
      setSaveError('');
      try {
        const response = await fetch(
          `/api/projects/status?project_id=${encodeURIComponent(row.projectId)}`,
          { method: 'DELETE', headers: { 'X-Member-Id': memberId } },
        );
        if (!response.ok) throw new Error(t('Не удалось удалить статус'));
        setStatuses((current) => current.filter((item) => item.projectId !== row.projectId));
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : t('Не удалось удалить статус'));
      }
    },
    [memberId, confirm, projectName],
  );

  const ownerName = (ownerId: string) => {
    const user = users.find((item) => String(item.id) === ownerId);
    return user ? user.name : '';
  };

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

  // Фильтры живут в адресе страницы: ссылку с одним проектом или клиентом
  // можно показать коллеге.
  const searchParams = useSearchParams();
  const [filterProject, setFilterProject] = useState(searchParams.get('project') || 'all');
  const [filterClient, setFilterClient] = useState(searchParams.get('client') || 'all');
  useEffect(() => {
    const params = new URLSearchParams();
    if (filterProject !== 'all') params.set('project', filterProject);
    if (filterClient !== 'all') params.set('client', filterClient);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, [filterProject, filterClient]);
  const clients = useMemo(
    () =>
      [...new Set(statuses.map((row) => row.client).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
    [statuses],
  );
  // Ссылка с фильтром переживает запись, на которую она указывала: без сброса
  // селект показывал пустое значение над пустой таблицей.
  useEffect(() => {
    if (isLoading || error) return;
    if (filterProject !== 'all' && !statuses.some((row) => row.projectId === filterProject))
      setFilterProject('all');
    if (filterClient !== 'all' && !clients.includes(filterClient)) setFilterClient('all');
  }, [isLoading, error, statuses, clients, filterProject, filterClient]);
  // Одна запись на проект: элемент списка адресуется кодом project-<id>, дублей нет.
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (filterProject === 'all' || row.projectId === filterProject) &&
          (filterClient === 'all' || row.client === filterClient),
      ),
    [rows, filterProject, filterClient],
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
      cell: (row) => {
        const status = asRow(row);
        return (
          <div className="flex justify-end gap-1">
            <Button
              variant="quiet"
              size="sm"
              aria-label={t('Правка')}
              title={t('Правка')}
              onClick={() => {
                setSaveError('');
                setEditing({ ...status });
              }}
            >
              <Pencil className="size-4" strokeWidth={1.7} />
            </Button>
            <Button
              variant="quiet"
              size="sm"
              aria-label={t('Удалить')}
              title={t('Удалить')}
              onClick={() => void removeStatus(status)}
            >
              <Trash2 className="size-4" strokeWidth={1.7} />
            </Button>
          </div>
        );
      },
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
        <>
          {/* Ошибка удаления или сохранения видна здесь, а не только в модалке
              правки: без неё клик по корзине выглядит как «ничего не произошло». */}
          {saveError && !editing && (
            <p role="alert" className="px-4 text-sm text-danger-text sm:px-6">
              {saveError}
            </p>
          )}
          {/* Тот же боковой отступ, что у шапки и списков задач: без него
              панель фильтров и таблица прилипали к краю окна. */}
          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6">
            <SelectField
              size="sm"
              variant="boxed"
              aria-label={t('Проект')}
              value={filterProject}
              onChange={(event) => setFilterProject(event.target.value)}
              options={[
                { value: 'all', label: t('Все проекты') },
                ...statuses
                  .map((row) => row.projectId)
                  .filter((id, index, all) => all.indexOf(id) === index)
                  .map((id) => ({ value: id, label: projectName(id) })),
              ]}
              className="w-56"
            />
            <SelectField
              size="sm"
              variant="boxed"
              aria-label={t('Клиент')}
              value={filterClient}
              onChange={(event) => setFilterClient(event.target.value)}
              options={[
                { value: 'all', label: t('Все клиенты') },
                ...clients.map((client) => ({ value: client, label: client })),
              ]}
              className="w-48"
            />
            {(filterProject !== 'all' || filterClient !== 'all') && (
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  setFilterProject('all');
                  setFilterClient('all');
                }}
              >
                {t('Сбросить')}
              </Button>
            )}
          </div>
          <Card padding="none" className="mx-4 sm:mx-6 mb-6">
            <Table
              columns={columns}
              rows={visibleRows as unknown as Record<string, unknown>[]}
              rowKey={(row) => asRow(row).projectId}
              // Пустая выборка под фильтром это не «статусов нет»: иначе человек
              // идёт заводить запись, которая уже есть.
              emptyLabel={
                statuses.length
                  ? t('Под фильтр ничего не подходит')
                  : t('Статусы ещё не заведены — добавьте первый')
              }
            />
          </Card>
        </>
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
              // У проекта одна запись: выбор проекта с заведённым статусом
              // подставляет её в форму, иначе сохранение молча затирало бы поля пустыми.
              onChange={(event) =>
                setEditing(
                  statuses.find((row) => row.projectId === event.target.value) || {
                    ...editing,
                    projectId: event.target.value,
                  },
                )
              }
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
    </div>
  );
}
