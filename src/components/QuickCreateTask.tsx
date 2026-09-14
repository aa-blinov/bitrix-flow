'use client';

// Создание задачи с любого экрана. Раньше кнопка жила только внутри проекта,
// хотя работают люди в «Моих задачах» и «Всех задачах».
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useKanbanStore } from '@/store/kanban';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toolbarControl } from '@/components/ui/toolbar';
import { useTaskToasts } from '@/components/ui/toast';

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
      toasts.saved('Задача создана');
      setTitle('');
      setDescription('');
      setDeadline('');
      setOpen(false);
      void loadAllTasks();
    } catch (error) {
      toasts.failed('Задачу не создали', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className={toolbarControl}>
          <Plus size={14} />
          Новая задача
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Что нужно сделать"
            aria-label="Название задачи"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim() && projectId && assigneeId) void submit();
            }}
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Описание (необязательно)"
            aria-label="Описание задачи"
            rows={3}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Проект" className="w-full">
                <SelectValue placeholder="Проект" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger aria-label="Исполнитель" className="w-full">
                <SelectValue placeholder="Исполнитель" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            aria-label="Дедлайн"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!title.trim() || !projectId || !assigneeId || saving}
          >
            {saving ? 'Создаём…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
