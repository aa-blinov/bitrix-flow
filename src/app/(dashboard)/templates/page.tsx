'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Repeat } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/monos/Button';
import { Checkbox } from '@/components/monos/Checkbox';
import { Modal } from '@/components/monos/Modal';
import { SelectField } from '@/components/monos/SelectField';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { useTaskModal } from '@/components/project/shared';
import { t } from '@/lib/i18n';
import type { Recurrence, TaskTemplate } from '@/lib/task-templates';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';

const WEEK_DAYS = () => [t('пн'), t('вт'), t('ср'), t('чт'), t('пт'), t('сб'), t('вс')];

function recurrenceLabel(recurrence: Recurrence | null): string {
  if (!recurrence) return '';
  if (recurrence.period === 'weekly') {
    const names = WEEK_DAYS();
    const days = recurrence.weekDays
      .map((day) => names[day - 1])
      .filter(Boolean)
      .join(', ');
    return t('Каждую неделю: {0}, в {1}', days || '…', recurrence.time);
  }
  if (recurrence.period === 'monthly')
    return t('Каждый месяц {0}-го числа, в {1}', recurrence.monthDay, recurrence.time);
  return recurrence.everyDay > 1
    ? t('Раз в {0} дн., в {1}', recurrence.everyDay, recurrence.time)
    : recurrence.workdayOnly
      ? t('По рабочим дням, в {0}', recurrence.time)
      : t('Каждый день, в {0}', recurrence.time);
}

/** Шаблоны задач портала: задача по шаблону одним нажатием и регулярные задачи. */
export default function TemplatesPage() {
  // Объект из стора без useShallow каждый рендер новый и зацикливает перерисовку.
  const { users, projects, loadProjects } = useKanbanStore(
    useShallow((state) => ({
      users: state.users,
      projects: state.projects,
      loadProjects: state.loadProjects,
    })),
  );
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<TaskTemplate | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { open, modal } = useTaskModal();
  const confirm = useConfirm();

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
  }, [projects.length, loadProjects]);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/templates');
      if (!response.ok) throw new Error();
      setTemplates((await response.json()).templates || []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const createTask = async (template: TaskTemplate) => {
    setBusy(template.id);
    setError('');
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-task', templateId: template.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.taskId) throw new Error(data.message || '');
      await open(data.taskId);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t('Не удалось создать задачу по шаблону'),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (template: TaskTemplate) => {
    const agreed = await confirm({
      title: t('Удалить шаблон «{0}»?', template.title),
      description: template.recurrence
        ? t('Регулярные задачи по нему перестанут создаваться. Уже созданные задачи останутся.')
        : t('Уже созданные по нему задачи останутся.'),
      confirmLabel: t('Удалить'),
      destructive: true,
    });
    if (!agreed) return;
    const response = await fetch('/api/templates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: template.id }),
    }).catch(() => null);
    if (!response?.ok) setError(t('Не удалось удалить шаблон'));
    await load();
  };

  const name = (id: string) => users.find((user) => user.id === id)?.name || '';
  const project = (id: string) => projects.find((item) => item.id === id)?.name || '';

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader
        title={t('Шаблоны')}
        description={t('Шаблоны задач из Битрикс24: задача по шаблону и регулярные задачи')}
        actions={
          <Button
            size="sm"
            icon={<Plus className="size-4" strokeWidth={1.7} />}
            onClick={() => setEditing('new')}
          >
            {t('Новый шаблон')}
          </Button>
        }
      />
      <div className="mx-auto max-w-4xl px-4 pt-4 lg:px-6">
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger-text">
            {error}
          </p>
        )}
        {failed ? (
          <p role="alert" className="py-8 text-center text-danger-text">
            {t('Не удалось загрузить шаблоны.')}
          </p>
        ) : !templates ? (
          <LoadingState />
        ) : templates.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">
            {t(
              'Шаблонов пока нет. Шаблон экономит время на задачах, которые ставятся снова и снова.',
            )}
          </p>
        ) : (
          <ul aria-label={t('Шаблоны задач')} className="space-y-2">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-ui border border-line bg-canvas px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{template.title}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                    {name(template.responsibleId) && <span>{name(template.responsibleId)}</span>}
                    {project(template.groupId) && <span>{project(template.groupId)}</span>}
                    {template.recurrence && (
                      <span className="inline-flex items-center gap-1 text-accent-text">
                        <Repeat className="size-3" strokeWidth={1.7} />
                        {recurrenceLabel(template.recurrence)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === template.id}
                    onClick={() => void createTask(template)}
                  >
                    {t('Создать задачу')}
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setEditing(template)}>
                    {t('Изменить')}
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => void remove(template)}>
                    {t('Удалить')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <TemplateDialog
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {modal}
    </div>
  );
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: TaskTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { users, projects, currentUser } = useKanbanStore(
    useShallow((state) => ({
      users: state.users,
      projects: state.projects,
      currentUser: state.currentUser,
    })),
  );
  const initial = template?.recurrence;
  const [title, setTitle] = useState(template?.title || '');
  const [description, setDescription] = useState(template?.description || '');
  const [responsibleId, setResponsibleId] = useState(template?.responsibleId || currentUser.id);
  const [groupId, setGroupId] = useState(template?.groupId || '0');
  const [period, setPeriod] = useState<'none' | Recurrence['period']>(initial?.period || 'none');
  const [time, setTime] = useState(initial?.time || '10:00');
  const [weekDays, setWeekDays] = useState<number[]>(
    initial?.period === 'weekly' ? initial.weekDays : [1],
  );
  const [monthDay, setMonthDay] = useState(initial?.period === 'monthly' ? initial.monthDay : 1);
  const [workdayOnly, setWorkdayOnly] = useState(
    initial?.period === 'daily' ? initial.workdayOnly : true,
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const recurrence = (): Recurrence | null =>
    period === 'weekly'
      ? { period, weekDays, time }
      : period === 'monthly'
        ? { period, monthDay, time }
        : period === 'daily'
          ? { period, everyDay: 1, workdayOnly, time }
          : null;

  const save = async () => {
    if (!title.trim()) return;
    if (period === 'weekly' && weekDays.length === 0) {
      setError(t('Выберите хотя бы один день недели.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          id: template?.id,
          title,
          description,
          responsibleId,
          groupId,
          recurrence: recurrence(),
        }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || '');
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t('Не удалось сохранить шаблон'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? t('Шаблон «{0}»', template.title) : t('Новый шаблон')}
      size="md"
      footer={
        <Button onClick={() => void save()} disabled={!title.trim() || saving}>
          {t('Сохранить')}
        </Button>
      }
    >
      <div className="space-y-3">
        <TextField
          label={t('Название')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextArea
          label={t('Описание')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t('Исполнитель')}
            variant="boxed"
            value={responsibleId}
            onChange={(event) => setResponsibleId(event.target.value)}
            options={users.map((user) => ({ value: user.id, label: user.name }))}
          />
          <SelectField
            label={t('Проект')}
            variant="boxed"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            options={[
              { value: '0', label: t('Без проекта') },
              ...projects
                .filter((item) => !item.isArchived)
                .map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t('Повторять')}
            variant="boxed"
            value={period}
            onChange={(event) => setPeriod(event.target.value as typeof period)}
            options={[
              { value: 'none', label: t('Не повторять') },
              { value: 'daily', label: t('Каждый день') },
              { value: 'weekly', label: t('Каждую неделю') },
              { value: 'monthly', label: t('Каждый месяц') },
            ]}
          />
          {period !== 'none' && (
            <TextField
              label={t('Время создания')}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          )}
        </div>
        {period === 'daily' && (
          <Checkbox
            checked={workdayOnly}
            onChange={(event) => setWorkdayOnly(event.target.checked)}
          >
            {t('Только по рабочим дням')}
          </Checkbox>
        )}
        {period === 'weekly' && (
          <div role="group" aria-label={t('Дни недели')} className="flex flex-wrap gap-1">
            {WEEK_DAYS().map((label, index) => {
              const day = index + 1;
              const on = weekDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setWeekDays((list) =>
                      on ? list.filter((item) => item !== day) : [...list, day].sort(),
                    )
                  }
                  className={`min-w-10 rounded-ui border px-2 py-1 text-sm ${
                    on
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-line text-ink-soft hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {period === 'monthly' && (
          <TextField
            label={t('Число месяца')}
            type="number"
            min={1}
            max={31}
            value={String(monthDay)}
            onChange={(event) =>
              setMonthDay(Math.min(31, Math.max(1, Number(event.target.value) || 1)))
            }
          />
        )}
        {period !== 'none' && (
          <p className="text-xs text-ink-soft">
            {t('Портал сам будет создавать задачу по этому шаблону, начиная с сегодняшнего дня.')}
          </p>
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
