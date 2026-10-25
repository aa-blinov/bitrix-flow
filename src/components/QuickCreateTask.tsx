'use client';

// Создание задачи с любого экрана. Раньше кнопка жила только внутри проекта,
// хотя работают люди в «Моих задачах» и «Всех задачах».
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useKanbanStore } from '@/store/kanban';
import { Button } from '@/components/monos/Button';
import { Modal } from '@/components/monos/Modal';
import { SelectField } from '@/components/monos/SelectField';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl } from '@/components/monos/toolbar';
import { useTaskToasts } from '@/components/monos/toast';
import { t } from '@/lib/i18n';

export default function QuickCreateTask({ defaultProjectId }: { defaultProjectId?: string }) {
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  const currentUser = useKanbanStore((state) => state.currentUser);
  const createTask = useKanbanStore((state) => state.createTask);
  const loadAllTasks = useKanbanStore((state) => state.loadAllTasks);
  const toasts = useTaskToasts();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [assigneeId, setAssigneeId] = useState(currentUser.id || '');
  const [deadline, setDeadline] = useState('');
  // currentUser приезжает позже первого рендера, поэтому поле исполнителя
  // оставалось пустым и Битрикс отвечал «Не указан исполнитель».
  useEffect(() => {
    if (currentUser.id) setAssigneeId((current) => current || currentUser.id);
  }, [currentUser.id]);
  useEffect(() => {
    if (defaultProjectId) setProjectId((current) => current || defaultProjectId);
  }, [defaultProjectId]);

  const submit = async () => {
    if (!title.trim() || !projectId || !assigneeId) return;
    setSaving(true);
    try {
      await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        responsibleId: assigneeId,
        deadline: deadline || undefined,
        projectId,
      });
      toasts.saved(t('Задача создана'));
      setTitle('');
      setDescription('');
      setDeadline('');
      setOpen(false);
      void loadAllTasks();
    } catch (error) {
      toasts.failed(t('Задачу не создали'), error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        className={toolbarControl}
        icon={<Plus size={14} strokeWidth={1.7} />}
        onClick={() => setOpen(true)}
      >
        {t('Новая задача')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('Новая задача')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('Отмена')}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!title.trim() || !projectId || !assigneeId || saving}
              loading={saving}
            >
              {t('Создать')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField
            variant="boxed"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('Что нужно сделать')}
            aria-label={t('Название задачи')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim() && projectId && assigneeId) void submit();
            }}
          />
          <TextArea
            variant="boxed"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('Описание (необязательно)')}
            aria-label={t('Описание задачи')}
            rows={3}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              variant="boxed"
              aria-label={t('Проект')}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
            <SelectField
              variant="boxed"
              aria-label={t('Исполнитель')}
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              options={users.map((user) => ({ value: user.id, label: user.name }))}
            />
          </div>
          <TextField
            variant="boxed"
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            aria-label={t('Дедлайн')}
          />
        </div>
      </Modal>
    </>
  );
}
