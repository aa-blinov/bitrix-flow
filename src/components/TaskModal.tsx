'use client';
import { Bx24User, BxFile, BxTask, PRIORITY_LABELS, STATUS_LABELS } from '@/types/bitrix';
import { convertBxTask, useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  User,
  Users,
  Eye,
  Flag,
  Calendar,
  CheckSquare,
  Square,
  Plus,
  Send,
  ChevronDown,
  ChevronUp,
  Clock,
  MessageSquare,
  Layers,
  AlertTriangle,
  GripVertical,
  Trash2,
  Settings2,
  Play,
  Pause,
  CircleCheck,
  Clock3,
  RotateCcw,
  Paperclip,
  ClipboardCheck,
  Pencil,
} from 'lucide-react';
import { Avatar } from '@/components/monos/Avatar';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Checkbox } from '@/components/monos/Checkbox';
import { Chip } from '@/components/monos/Chip';
import { IconButton } from '@/components/monos/IconButton';
import { Modal } from '@/components/monos/Modal';
import { Notice } from '@/components/monos/Notice';
import { Popover } from '@/components/monos/Popover';
import { SelectField } from '@/components/monos/SelectField';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { useToast } from '@/components/monos/toast';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { toLocalInputValue } from '@/lib/utils';
import LoadingState from '@/components/LoadingState';
import BitrixText from '@/components/BitrixText';
import { formatBitrixDateTime } from '@/lib/bitrix-markup';
import { extractTaskTags, tagKey } from '@/lib/task-tags';
import { fetchProjectMembers, fetchTaskById, searchProjectTasks } from '@/lib/bitrix24';
import type { Bx24Task } from '@/lib/bitrix24';

function FileAttachments({ files, attached }: { files?: BxFile[]; attached?: boolean }) {
  if (!files?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((file) => {
        const href = `/api/task-file/${file.id}${attached ? '?attached=1' : ''}`;
        if (file.type === 'image') {
          return (
            <a
              key={file.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={file.name}
              className="block overflow-hidden rounded-ui border border-line"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={href}
                alt={file.name}
                loading="lazy"
                className="max-h-56 w-auto max-w-full object-contain"
              />
            </a>
          );
        }
        return (
          <a
            key={file.id}
            href={`${href}${attached ? '&' : '?'}download=1`}
            className="flex items-center gap-2 rounded-ui border border-line px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-2"
          >
            <Paperclip size={13} strokeWidth={1.7} className="shrink-0 text-ink-faint" />
            <span className="max-w-56 truncate">{file.name}</span>
            <span className="shrink-0 text-ink-faint">{formatFileSize(file.size)}</span>
          </a>
        );
      })}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!bytes) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: value < 10 && index > 0 ? 1 : 0 })} ${units[index]}`;
}

// Слово-статус задачи: цвет здесь — состояние, а не украшение.
function statusTone(status: string): 'neutral' | 'accent' | 'danger' | 'warning' | 'success' {
  if (status === 'done') return 'success';
  if (status === 'in_progress') return 'accent';
  if (status === 'deferred') return 'warning';
  return 'neutral';
}

export default function TaskModal({ task, onClose }: { task: BxTask; onClose: () => void }) {
  const {
    updateTaskField,
    currentUser,
    moveTaskToProject,
    addComment,
    addTaskResult,
    updateTaskResult,
    deleteTaskResult,
    addTimeEntry,
    updateTimeEntry,
    deleteTimeEntry,
    users,
    projects,
    tasks,
    subtasks,
    loadSubtasks,
    createTask,
    moveTask,
    moveTaskToStage,
    stages,
    addChecklistItem,
    setChecklistItemCompleted,
    deleteChecklistItem,
    updateChecklistItem,
    attachFile,
    isLoadingTask,
  } = useKanbanStore(
    useShallow((s) => ({
      updateTaskField: s.updateTaskField,
      currentUser: s.currentUser,
      moveTaskToProject: s.moveTaskToProject,
      addComment: s.addComment,
      addTaskResult: s.addTaskResult,
      updateTaskResult: s.updateTaskResult,
      deleteTaskResult: s.deleteTaskResult,
      addTimeEntry: s.addTimeEntry,
      updateTimeEntry: s.updateTimeEntry,
      deleteTimeEntry: s.deleteTimeEntry,
      users: s.users,
      projects: s.projects,
      tasks: s.tasks,
      subtasks: s.subtasks,
      loadSubtasks: s.loadSubtasks,
      createTask: s.createTask,
      moveTask: s.moveTask,
      moveTaskToStage: s.moveTaskToStage,
      stages: s.stages,
      addChecklistItem: s.addChecklistItem,
      setChecklistItemCompleted: s.setChecklistItemCompleted,
      deleteChecklistItem: s.deleteChecklistItem,
      updateChecklistItem: s.updateChecklistItem,
      attachFile: s.attachFile,
      isLoadingTask: s.isLoadingTask,
    })),
  );

  const router = useRouter();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [isSendingComment, setIsSendingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [taskResultText, setTaskResultText] = useState('');
  const [isSendingResult, setIsSendingResult] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [editingResultText, setEditingResultText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [showTimeEntry, setShowTimeEntry] = useState(false);
  // Какую запись времени правим: пусто — значит добавляем новую.
  const [editingTimeEntryId, setEditingTimeEntryId] = useState<string | null>(null);
  const [showSubtaskAdd, setShowSubtaskAdd] = useState(false);
  const [showExistingSubtaskPicker, setShowExistingSubtaskPicker] = useState(false);
  const [existingSubtaskQuery, setExistingSubtaskQuery] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [timeHours, setTimeHours] = useState(1);
  const [timeDesc, setTimeDesc] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showSubtasks, setShowSubtasks] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [isAttaching, setIsAttaching] = useState(false);
  // Пункт чек-листа, который сейчас переименовывают.
  const [editingChecklistItemId, setEditingChecklistItemId] = useState<string | null>(null);
  const [checklistItemDraft, setChecklistItemDraft] = useState('');
  const [activeChecklistId, setActiveChecklistId] = useState<string | null>(null);
  const [parentQuery, setParentQuery] = useState('');
  const [parentSearchResults, setParentSearchResults] = useState<Bx24Task[]>([]);
  const [existingSubtaskResults, setExistingSubtaskResults] = useState<Bx24Task[]>([]);
  const [projectMemberIds, setProjectMemberIds] = useState<string[]>([]);
  const [actionsVersion, setActionsVersion] = useState(0);
  const [allowedActions, setAllowedActions] = useState<Record<string, boolean> | null>(
    task.actions || null,
  );
  const [focusConflict, setFocusConflict] = useState<BxTask | null>(null);
  const userLabel = (user: Bx24User) =>
    users.filter((candidate) => candidate.name === user.name).length > 1 && user.email
      ? `${user.name} (${user.email})`
      : user.name;
  const commentsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchProjectMembers(task.projectId)
      .then((members) =>
        setProjectMemberIds(
          (Array.isArray(members) ? members : []).map((member: any) => String(member.USER_ID)),
        ),
      )
      .catch(() => setProjectMemberIds([]));
  }, [task.projectId]);

  useEffect(() => {
    const element = commentsRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [task.id, task.comments.length]);

  useEffect(() => {
    const query = parentQuery.trim();
    const shouldSearch = /^\d+$/.test(query) || query.length >= 2;
    if (!shouldSearch) {
      setParentSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchProjectTasks(task.projectId, query).then((results) => {
        if (!cancelled) setParentSearchResults(results);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [parentQuery, task.projectId]);

  useEffect(() => {
    const query = existingSubtaskQuery.trim();
    const shouldSearch = /^\d+$/.test(query) || query.length >= 2;
    if (!shouldSearch) {
      setExistingSubtaskResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchProjectTasks(task.projectId, query).then((results) => {
        if (!cancelled) setExistingSubtaskResults(results);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [existingSubtaskQuery, task.projectId]);

  const taskSubtasks = subtasks[task.id] || [];
  // Теги двух видов: штатные поля TAGS (правятся здесь) и #хэштеги из
  // названия/описания (живут в тексте, убираются правкой текста).
  const textTagKeys = new Set(extractTaskTags(task.title, task.description).map(tagKey));
  // Штатные теги (без #) сохраняются целиком; #хэштеги — те, что Битрикс ещё
  // не превратил в штатные. Тег, который есть в тексте, крестиком не убрать:
  // Битрикс вернёт его при следующем сохранении описания.
  const ownTags = (task.tags || []).filter((tag) => !tag.startsWith('#'));
  const textTags = (task.tags || []).filter((tag) => tag.startsWith('#'));
  const isFromText = (tag: string) => textTagKeys.has(tagKey(tag));
  const [tagDraft, setTagDraft] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<string[] | null>(null);
  const loadTagSuggestions = () => {
    if (tagSuggestions) return;
    setTagSuggestions([]);
    const params = new URLSearchParams(
      task.projectId && task.projectId !== '0' ? { projectId: task.projectId } : {},
    );
    void fetch(`/api/tasks/tags?${params}`)
      .then((response) => (response.ok ? response.json() : { tags: [] }))
      .then((data) =>
        setTagSuggestions(
          (Array.isArray(data.tags) ? data.tags : [])
            .map((item: { tag: string }) => String(item.tag))
            .filter((tag: string) => !tag.startsWith('#')),
        ),
      )
      .catch(() => {});
  };
  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '').replace(/,$/, '').trim();
    setTagDraft('');
    if (!tag || (task.tags || []).some((item) => tagKey(item) === tagKey(tag))) return;
    void handleUpdateField('tags', [...ownTags, tag]);
  };
  const removeTag = (tag: string) =>
    void handleUpdateField(
      'tags',
      ownTags.filter((item) => item !== tag),
    );
  const projectStages = stages.filter(
    (stage) => !stage.entityId || String(stage.entityId) === String(task.projectId),
  );
  const selectedStageId =
    projectStages.find((stage) => stage.id === task.stageId)?.id ||
    (task.stageId === '0'
      ? projectStages.find((stage) => stage.systemType === 'NEW')?.id || projectStages[0]?.id
      : task.stageId);
  const mentionQuery = comment.match(/(?:^|\s)@([^\s]*)$/)?.[1];
  const mentionUsers =
    mentionQuery === undefined
      ? []
      : users
          .filter((user) =>
            user.name.toLocaleLowerCase('ru').includes(mentionQuery.toLocaleLowerCase('ru')),
          )
          .slice(0, 5);

  useEffect(() => {
    let cancelled = false;
    // Права на действия приезжают вместе с полной задачей — если она уже в
    // сторе, перечитывать её заново незачем. После смены статуса права в
    // сторе устаревшие, поэтому перечитываем (actionsVersion > 0).
    const fromStore = actionsVersion === 0 ? task.actions : undefined;
    if (fromStore) {
      setAllowedActions(fromStore);
      return;
    }
    void fetchTaskById(task.id)
      .then((freshTask) => {
        if (!cancelled) setAllowedActions(freshTask.actions || {});
      })
      .catch(() => {
        if (!cancelled) setAllowedActions({});
      });
    return () => {
      cancelled = true;
    };
    // Права зависят от статуса: после «Начать» — «Приостановить», после
    // «Завершить» — «Возобновить». Перечитываем их, когда Битрикс подтвердил
    // смену статуса (actionsVersion), а не на оптимистичной правке: тогда он
    // ещё отдавал права старого статуса, и «Отложить» у задачи в работе
    // падало с «Действие не доступно».
  }, [task.id, actionsVersion]);

  const can = (action: string) => allowedActions?.[action] === true;

  const handleUpdateField = async (field: string, value: any) => {
    // Пока статус меняется, кнопки статуса прячем: права ещё старые.
    if (field === 'status') setAllowedActions(null);
    try {
      setFieldError(null);
      await updateTaskField(task.id, field, value);
      setEditingField(null);
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : 'Не удалось сохранить изменения');
    } finally {
      if (field === 'status') setActionsVersion((version) => version + 1);
    }
  };

  const handleStartTask = async () => {
    // «В работе» у человека одна задача. Раньше для проверки грузился общий
    // список (первые 50 задач портала): «Начать» ждало его секундами, а задача
    // в работе из-за пределов этих 50 не находилась. Спрашиваем сервер прямо.
    let activeTask: BxTask | undefined;
    try {
      const params = new URLSearchParams({
        status: 'in_progress',
        assigneeId: String(currentUser.id),
        limit: '5',
      });
      const response = await fetch(`/api/tasks/all?${params}`);
      const data = response.ok ? await response.json() : { tasks: [] };
      activeTask = (Array.isArray(data.tasks) ? data.tasks : [])
        .map(convertBxTask)
        .find((item: BxTask) => item.id !== task.id);
    } catch {
      // Проверка — подсказка, а не условие: без неё просто запускаем задачу.
    }

    if (activeTask) {
      setFocusConflict(activeTask);
      return;
    }

    await handleUpdateField('status', 'in_progress');
  };

  const confirmFocusChange = async () => {
    if (!focusConflict) return;
    try {
      setFieldError(null);
      setAllowedActions(null);
      await updateTaskField(focusConflict.id, 'status', 'new');
      await updateTaskField(task.id, 'status', 'in_progress');
      setFocusConflict(null);
      setActionsVersion((version) => version + 1);
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : 'Не удалось изменить статус');
    }
  };

  const openFocusConflict = () => {
    if (!focusConflict) return;
    const taskId = focusConflict.id;
    const projectId = focusConflict.projectId;
    setFocusConflict(null);
    onClose();
    router.push(`/projects/${projectId}?task=${taskId}`);
  };

  // Перенос в другой проект — правка поля, а не переход: раньше карточка
  // закрывалась и открывалась доска нового проекта, и человек терял место,
  // где работал. Теперь остаёмся здесь, а в проект ведёт кнопка в тосте.
  const handleMoveProject = async (projectId: string) => {
    // Псевдо-проект «Без проекта» — это GROUP_ID = 0, отдельной сущности нет.
    const isNoProject = projectId === 'none' || projectId === NO_PROJECT_ID;
    const projectName = isNoProject
      ? NO_PROJECT_NAME
      : projects.find((project) => project.id === projectId)?.name || 'проект';
    const targetId = isNoProject ? NO_PROJECT_ID : projectId;
    try {
      await moveTaskToProject(task.id, projectId);
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : 'Не удалось перенести задачу');
      return;
    }
    toast({
      title: `Задача перенесена в «${projectName}»`,
      tone: 'success',
      action: {
        label: 'Открыть проект',
        onClick: () => {
          onClose();
          router.push(`/projects/${targetId}?task=${encodeURIComponent(task.id)}`);
        },
      },
    });
  };

  const handleAddComment = async () => {
    const text = comment.trim();
    if (!text || isSendingComment) return;

    setComment('');
    setCommentError(null);
    setIsSendingComment(true);
    try {
      await addComment(task.id, text);
    } catch {
      setComment((current) => current || text);
      setCommentError('Не удалось отправить комментарий. Попробуйте ещё раз.');
    } finally {
      setIsSendingComment(false);
    }
  };

  const handleAddResult = async () => {
    const text = taskResultText.trim();
    if (!text || isSendingResult) return;

    setTaskResultText('');
    setResultError(null);
    setIsSendingResult(true);
    try {
      await addTaskResult(task.id, text);
    } catch {
      setTaskResultText((current) => current || text);
      setResultError('Не удалось сохранить результат. Попробуйте ещё раз.');
    } finally {
      setIsSendingResult(false);
    }
  };

  const handleUpdateResult = async (resultId: string) => {
    const text = editingResultText.trim();
    if (!text) return;
    setEditingResultId(null);
    try {
      await updateTaskResult(task.id, resultId, text);
    } catch {
      toast({ title: 'Не удалось изменить результат', tone: 'danger' });
    }
  };

  const handleDeleteResult = async (resultId: string) => {
    try {
      await deleteTaskResult(task.id, resultId);
    } catch {
      toast({ title: 'Не удалось удалить результат', tone: 'danger' });
    }
  };

  const handleAddTime = async () => {
    if (timeHours <= 0) return;
    try {
      if (editingTimeEntryId) {
        await updateTimeEntry(task.id, editingTimeEntryId, timeHours, timeDesc);
      } else {
        await addTimeEntry(task.id, timeHours, timeDesc);
      }
      setEditingTimeEntryId(null);
      setTimeHours(1);
      setTimeDesc('');
      setShowTimeEntry(false);
    } catch (error) {
      toast({
        title: editingTimeEntryId
          ? 'Не удалось изменить запись времени'
          : 'Не удалось записать время',
        description: error instanceof Error ? error.message : undefined,
        tone: 'danger',
      });
    }
  };

  const handleDeleteTime = async (entryId: string) => {
    try {
      await deleteTimeEntry(task.id, entryId);
    } catch (error) {
      toast({
        title: 'Не удалось удалить запись времени',
        description: error instanceof Error ? error.message : undefined,
        tone: 'danger',
      });
    }
  };

  const handleAttachFile = async (file: File | undefined) => {
    if (!file) return;
    setIsAttaching(true);
    try {
      await attachFile(task.id, file);
    } catch (error) {
      toast({
        title: 'Не удалось прикрепить файл',
        description: error instanceof Error ? error.message : undefined,
        tone: 'danger',
      });
    } finally {
      setIsAttaching(false);
    }
  };

  const commitChecklistItemRename = async (itemId: string) => {
    const title = checklistItemDraft.trim();
    setEditingChecklistItemId(null);
    setChecklistItemDraft('');
    if (!title) return;
    try {
      await updateChecklistItem(task.id, itemId, title);
    } catch (error) {
      toast({
        title: 'Не удалось переименовать пункт',
        description: error instanceof Error ? error.message : undefined,
        tone: 'danger',
      });
    }
  };

  const handleAddChecklistItem = async (parentId = activeChecklistId) => {
    if (!newChecklistItem.trim()) return;
    await addChecklistItem(task.id, newChecklistItem.trim(), parentId || undefined);
    setNewChecklistItem('');
  };

  const handleAddSubtask = async () => {
    if (newSubtaskTitle.trim()) {
      // Битрикс не создаёт задачу без исполнителя, а без проекта подзадача
      // уехала бы в текущий выбранный проект, а не в проект родителя.
      try {
        await createTask({
          title: newSubtaskTitle,
          parentId: task.id,
          projectId: task.projectId && task.projectId !== '0' ? task.projectId : undefined,
          responsibleId: task.assigneeId || currentUser.id,
        });
      } catch (error) {
        setFieldError(error instanceof Error ? error.message : 'Не удалось создать подзадачу');
        return;
      }
      setNewSubtaskTitle('');
      setShowSubtaskAdd(false);
      void loadSubtasks(task.id);
    }
  };

  const handleAttachExistingSubtask = async (subtaskId: string) => {
    await updateTaskField(subtaskId, 'parentId', task.id);
    setExistingSubtaskQuery('');
    setShowExistingSubtaskPicker(false);
    await loadSubtasks(task.id);
  };

  const formatDate = (dateStr: string) => (dateStr ? formatBitrixDateTime(dateStr) : '');

  const priorityOptions = [
    { value: 'low', label: 'Низкий' },
    { value: 'medium', label: 'Обычный' },
    { value: 'high', label: 'Высокий' },
  ];

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  const projectOptions = [
    { value: 'none', label: 'Без проекта' },
    ...projects
      // Архивный проект в список переноса не предлагаем, но текущий
      // оставляем: иначе у задачи архивного проекта поле пустое.
      .filter((project) => !project.isArchived || project.id === task.projectId)
      .map((project) => ({ value: project.id, label: project.name })),
  ];

  const assigneeOptions = [
    { value: 'unassigned', label: 'Не назначен' },
    ...users.map((user) => ({ value: user.id, label: userLabel(user) })),
  ];

  const memberUsers = users.filter((user) => projectMemberIds.includes(user.id));

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={task.title}
        size="xl"
        showClose={false}
        closeOnBackdrop={false}
        // Пока открыт диалог о чужой задаче в работе, Escape закрывает его,
        // а не всю карточку.
        closeOnEscape={!focusConflict}
        className="max-w-none lg:max-w-[60rem]"
      >
        {fieldError && (
          <div className="mb-3">
            <Notice tone="danger">{fieldError}</Notice>
          </div>
        )}
        {/* На телефоне кнопки статуса и фаза не влезали в строку и растягивали
            всю карточку вширь: переносим их, а «Закрыть» держим справа. */}
        <div className="sticky top-0 z-10 -mx-6 mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-6 py-2 sm:-mx-8 sm:px-8">
          <span className="text-whisper text-ink-faint">#{task.id}</span>
          <Badge tone={statusTone(task.status)}>{STATUS_LABELS[task.status] || task.status}</Badge>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {/* Отложенную Битрикс не «стартует», а возвращает в «Новая» (renew)
                или завершает: раньше тут ждали start, и шапка была пустой. */}
            {task.status === 'deferred' && (
              <>
                {can('renew') && (
                  <Button size="sm" onClick={() => void handleUpdateField('status', 'new')}>
                    Возобновить
                  </Button>
                )}
                {can('complete') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleUpdateField('status', 'done')}
                  >
                    Завершить
                  </Button>
                )}
              </>
            )}
            {task.status === 'new' && (
              <>
                {can('start') && (
                  <Button size="sm" onClick={() => void handleStartTask()}>
                    Начать
                  </Button>
                )}
                {task.status === 'new' && can('defer') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleUpdateField('status', 'deferred')}
                  >
                    Отложить
                  </Button>
                )}
              </>
            )}
            {task.status === 'in_progress' && (
              <>
                {can('pause') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleUpdateField('status', 'new')}
                  >
                    Приостановить
                  </Button>
                )}
                {can('defer') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleUpdateField('status', 'deferred')}
                  >
                    Отложить
                  </Button>
                )}
                {can('complete') && (
                  <Button size="sm" onClick={() => void handleUpdateField('status', 'done')}>
                    Завершить
                  </Button>
                )}
              </>
            )}
            {task.status === 'testing' && (
              <>
                {can('defer') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleUpdateField('status', 'deferred')}
                  >
                    Отложить
                  </Button>
                )}
                {can('complete') && (
                  <Button size="sm" onClick={() => void handleUpdateField('status', 'done')}>
                    Завершить
                  </Button>
                )}
              </>
            )}
            {task.status === 'done' && can('renew') && (
              <Button size="sm" onClick={() => void handleUpdateField('status', 'new')}>
                Возобновить
              </Button>
            )}
          </div>
          {projectStages.length > 0 && (
            <SelectField
              aria-label="Фаза задачи"
              variant="boxed"
              size="sm"
              className="w-40"
              value={selectedStageId ?? ''}
              onChange={(event) => {
                if (event.target.value) void moveTaskToStage(task.id, event.target.value);
              }}
              options={projectStages.map((stage) => ({ value: stage.id, label: stage.name }))}
            />
          )}
          <div className="ml-auto flex items-center gap-1">
            {/* Заголовок окна — имя задачи: править его можно только здесь,
                поэтому кнопка-карандаш стоит рядом с ним. */}
            <IconButton
              label="Изменить название"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingField('title');
                setEditValue(task.title);
              }}
            >
              <Pencil size={14} strokeWidth={1.7} />
            </IconButton>
            <IconButton label="Закрыть задачу" variant="ghost" size="sm" onClick={onClose}>
              <X size={16} strokeWidth={1.7} />
            </IconButton>
          </div>
        </div>

        {editingField === 'title' && (
          <div className="mb-3">
            <TextField
              variant="boxed"
              size="lg"
              autoFocus
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              onBlur={() => void handleUpdateField('title', editValue)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleUpdateField('title', editValue);
              }}
              aria-label="Название задачи"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Main */}
          <div className="min-w-0 space-y-4 md:col-span-2">
            {/* Description */}
            <div>
              <h3 className="mb-2 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                Описание
              </h3>
              {editingField === 'description' ? (
                <TextArea
                  variant="boxed"
                  rows={3}
                  autoFocus
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onBlur={() => void handleUpdateField('description', editValue)}
                />
              ) : (
                <div
                  className="min-h-[50px] cursor-pointer rounded-ui bg-surface-2 p-3 text-sm text-ink"
                  onClick={() => {
                    setEditingField('description');
                    setEditValue(task.description);
                  }}
                >
                  {task.description ? (
                    <BitrixText text={task.description} />
                  ) : (
                    <span className="text-ink-faint">Добавить описание…</span>
                  )}
                </div>
              )}
              {/* Вложения описания кликабельны и вне режима редактирования */}
              <FileAttachments files={task.attachments} attached />
              <div className="mt-2 flex items-center gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-ui border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:text-ink ${
                    isAttaching ? 'pointer-events-none opacity-60' : ''
                  }`}
                >
                  <Paperclip size={14} strokeWidth={1.7} className="text-ink-faint" />
                  {isAttaching ? 'Прикрепляем…' : 'Прикрепить файл'}
                  <input
                    type="file"
                    className="hidden"
                    aria-label="Прикрепить файл к задаче"
                    onChange={(event) => {
                      void handleAttachFile(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                Теги
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                {ownTags.map((tag) =>
                  isFromText(tag) ? (
                    <Chip
                      key={tag}
                      size="md"
                      title="Из названия или описания: убирается правкой текста"
                    >
                      {tag}
                    </Chip>
                  ) : (
                    <Chip
                      key={tag}
                      size="md"
                      removable
                      removeLabel={`Убрать тег ${tag}`}
                      onRemove={() => void removeTag(tag)}
                    >
                      {tag}
                    </Chip>
                  ),
                )}
                {textTags.map((tag) => (
                  <Chip
                    key={tag}
                    size="md"
                    title="Хэштег из названия или описания: убирается правкой текста"
                  >
                    {tag}
                  </Chip>
                ))}
                <TextField
                  size="sm"
                  className="w-36"
                  value={tagDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.endsWith(',')) addTag(value);
                    else setTagDraft(value);
                  }}
                  onFocus={loadTagSuggestions}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTag(tagDraft);
                    }
                  }}
                  onBlur={() => tagDraft.trim() && addTag(tagDraft)}
                  list={`task-tags-${task.id}`}
                  placeholder="Добавить тег…"
                  aria-label="Добавить тег"
                />
                <datalist id={`task-tags-${task.id}`}>
                  {(tagSuggestions || [])
                    .filter((tag) => !ownTags.includes(tag))
                    .map((tag) => (
                      <option key={tag} value={tag} />
                    ))}
                </datalist>
              </div>
            </div>

            {/* Subtasks - Collapsible */}
            <Card padding="none" className="overflow-hidden">
              <Button
                onClick={() => setShowSubtasks(!showSubtasks)}
                variant="quiet"
                size="sm"
                className="h-auto w-full justify-start gap-2 px-4 py-3"
                icon={<CheckSquare size={14} strokeWidth={1.7} className="text-ink-faint" />}
                trailing={
                  showSubtasks ? (
                    <ChevronUp size={14} strokeWidth={1.7} className="text-ink-faint" />
                  ) : (
                    <ChevronDown size={14} strokeWidth={1.7} className="text-ink-faint" />
                  )
                }
              >
                Подзадачи ({taskSubtasks.length})
              </Button>

              {showSubtasks && (
                <div className="space-y-2 p-3">
                  {taskSubtasks.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center gap-3 rounded-ui bg-surface-2 p-2"
                    >
                      <GripVertical size={14} strokeWidth={1.7} className="text-ink-faint" />
                      <Checkbox
                        checked={sub.status === 'done'}
                        onChange={() =>
                          void moveTask(sub.id, sub.status === 'done' ? 'new' : 'done')
                        }
                        ariaLabel={
                          sub.status === 'done'
                            ? 'Вернуть подзадачу в работу'
                            : 'Завершить подзадачу'
                        }
                      />
                      <span
                        className={`flex-1 text-sm ${
                          sub.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'
                        }`}
                      >
                        {sub.title}
                      </span>
                      <span className="text-whisper text-ink-faint">#{sub.id}</span>
                    </div>
                  ))}

                  {showSubtaskAdd ? (
                    <div className="flex items-center gap-2 rounded-ui bg-surface-2 p-2">
                      <Square size={16} strokeWidth={1.7} className="text-ink-faint" />
                      <TextField
                        variant="underline"
                        size="sm"
                        className="flex-1"
                        value={newSubtaskTitle}
                        onChange={(event) => setNewSubtaskTitle(event.target.value)}
                        placeholder="Название подзадачи…"
                        aria-label="Название подзадачи"
                        autoFocus
                        onKeyDown={(event) => event.key === 'Enter' && void handleAddSubtask()}
                      />
                      <IconButton
                        label="Добавить подзадачу"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleAddSubtask()}
                      >
                        <Plus size={14} strokeWidth={1.7} />
                      </IconButton>
                      <IconButton
                        label="Отменить"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSubtaskAdd(false)}
                      >
                        <X size={14} strokeWidth={1.7} />
                      </IconButton>
                    </div>
                  ) : showExistingSubtaskPicker ? (
                    <div className="relative rounded-ui bg-surface-2 p-2">
                      <TextField
                        variant="underline"
                        size="sm"
                        value={existingSubtaskQuery}
                        onChange={(event) => setExistingSubtaskQuery(event.target.value)}
                        placeholder="Найти существующую задачу…"
                        aria-label="Найти существующую задачу"
                        autoFocus
                      />
                      {existingSubtaskQuery && (
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-ui border border-line bg-canvas p-1">
                          {existingSubtaskResults
                            .filter(
                              (candidate) =>
                                candidate.id !== task.id &&
                                candidate.id !== task.parentId &&
                                candidate.parentId !== task.id,
                            )
                            .slice(0, 10)
                            .map((candidate) => (
                              <Button
                                key={candidate.id}
                                variant="quiet"
                                size="sm"
                                className="h-auto w-full justify-start px-2 py-1.5 text-left"
                                onClick={() => void handleAttachExistingSubtask(candidate.id)}
                              >
                                #{candidate.id}, {candidate.title}
                              </Button>
                            ))}
                        </div>
                      )}
                      <Button
                        onClick={() => {
                          setExistingSubtaskQuery('');
                          setShowExistingSubtaskPicker(false);
                        }}
                        variant="quiet"
                        size="sm"
                        className="mt-1 h-auto w-full justify-start text-xs"
                      >
                        Отмена
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => setShowExistingSubtaskPicker(true)}
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        icon={<Plus size={14} strokeWidth={1.7} />}
                      >
                        Выбрать существующую
                      </Button>
                      <Button
                        onClick={() => setShowSubtaskAdd(true)}
                        variant="quiet"
                        size="sm"
                        className="flex-1"
                        icon={<Plus size={14} strokeWidth={1.7} />}
                      >
                        Создать новую
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
                  <CheckSquare size={14} strokeWidth={1.7} className="text-ink-faint" />
                  Чек-лист ({task.checklist?.filter((item) => item.completed).length || 0}/
                  {task.checklist?.length || 0})
                </h3>
              </div>
              <div className="space-y-3 p-3">
                {task.checklist
                  ?.filter((item) => item.parentId === '0')
                  .map((list) => (
                    <div key={list.id} className="rounded-ui border border-line bg-surface-2 p-2">
                      <div className="px-1 text-sm font-bold text-ink">{list.title}</div>
                      {task.checklist
                        ?.filter((item) => item.parentId === list.id)
                        .map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 rounded-ui px-1 py-1 hover:bg-surface"
                          >
                            <Checkbox
                              checked={item.completed}
                              ariaLabel={
                                item.completed ? 'Отметить незавершённым' : 'Отметить выполненным'
                              }
                              onChange={() =>
                                void setChecklistItemCompleted(task.id, item.id, !item.completed)
                              }
                            />
                            {editingChecklistItemId === item.id ? (
                              <TextField
                                variant="underline"
                                size="sm"
                                autoFocus
                                className="min-w-0 flex-1"
                                value={checklistItemDraft}
                                aria-label="Название пункта чек-листа"
                                onChange={(event) => setChecklistItemDraft(event.target.value)}
                                onBlur={() => void commitChecklistItemRename(item.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter')
                                    void commitChecklistItemRename(item.id);
                                  if (event.key === 'Escape') {
                                    setEditingChecklistItemId(null);
                                    setChecklistItemDraft('');
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                title="Переименовать пункт"
                                className={`min-w-0 flex-1 text-left text-sm ${
                                  item.completed ? 'text-ink-faint line-through' : 'text-ink'
                                }`}
                                onClick={() => {
                                  setEditingChecklistItemId(item.id);
                                  setChecklistItemDraft(item.title);
                                }}
                              >
                                {item.title}
                              </button>
                            )}
                            <IconButton
                              label="Удалить пункт"
                              variant="ghost"
                              size="sm"
                              onClick={() => void deleteChecklistItem(task.id, item.id)}
                            >
                              <Trash2 size={14} strokeWidth={1.7} />
                            </IconButton>
                          </div>
                        ))}
                      <div className="mt-2 flex gap-2">
                        <TextField
                          variant="underline"
                          size="sm"
                          value={activeChecklistId === list.id ? newChecklistItem : ''}
                          onFocus={() => setActiveChecklistId(list.id)}
                          onChange={(event) => {
                            setActiveChecklistId(list.id);
                            setNewChecklistItem(event.target.value);
                          }}
                          placeholder="Добавить пункт…"
                          aria-label="Добавить пункт чек-листа"
                          onKeyDown={(event) =>
                            event.key === 'Enter' && void handleAddChecklistItem()
                          }
                        />
                        <Button
                          size="sm"
                          onClick={() => void handleAddChecklistItem(list.id)}
                          disabled={activeChecklistId !== list.id || !newChecklistItem.trim()}
                        >
                          Добавить
                        </Button>
                      </div>
                    </div>
                  ))}
                <div className="flex gap-2 border-t border-line pt-3">
                  <TextField
                    variant="underline"
                    size="sm"
                    value={activeChecklistId === null ? newChecklistItem : ''}
                    onFocus={() => setActiveChecklistId(null)}
                    onChange={(event) => {
                      setActiveChecklistId(null);
                      setNewChecklistItem(event.target.value);
                    }}
                    placeholder="Название нового чек-листа…"
                    aria-label="Название нового чек-листа"
                    onKeyDown={(event) => event.key === 'Enter' && void handleAddChecklistItem()}
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleAddChecklistItem(null)}
                    disabled={activeChecklistId !== null || !newChecklistItem.trim()}
                  >
                    Создать
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="min-w-0 space-y-4">
            {/* Properties - Collapsible */}
            <Card padding="none" className="overflow-hidden">
              <Button
                onClick={() => setShowDetails(!showDetails)}
                variant="quiet"
                size="sm"
                className="h-auto w-full justify-start gap-2 px-4 py-3"
                icon={<Layers size={14} strokeWidth={1.7} className="text-ink-faint" />}
                trailing={
                  showDetails ? (
                    <ChevronUp size={14} strokeWidth={1.7} className="text-ink-faint" />
                  ) : (
                    <ChevronDown size={14} strokeWidth={1.7} className="text-ink-faint" />
                  )
                }
              >
                Детали
              </Button>

              {showDetails && (
                <div className="space-y-4 p-4">
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      <Layers size={12} strokeWidth={1.7} /> Проект
                    </p>
                    <SelectField
                      variant="boxed"
                      aria-label="Проект"
                      value={task.projectId || 'none'}
                      onChange={(event) => {
                        void handleMoveProject(event.target.value);
                      }}
                      options={projectOptions}
                    />
                  </div>

                  {/* Assignee */}
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      <User size={12} strokeWidth={1.7} /> Исполнитель
                    </p>
                    {editingField === 'assigneeId' ? (
                      <SelectField
                        variant="boxed"
                        aria-label="Исполнитель"
                        value={task.assigneeId || 'unassigned'}
                        onChange={(event) =>
                          void handleUpdateField(
                            'assigneeId',
                            event.target.value === 'unassigned' ? '' : event.target.value,
                          )
                        }
                        options={assigneeOptions}
                      />
                    ) : (
                      <p
                        className="-mx-1 cursor-pointer rounded-ui px-1 py-0.5 text-sm font-medium text-ink hover:bg-surface-2"
                        onClick={() => setEditingField('assigneeId')}
                      >
                        {task.assigneeName || 'Не назначен'}
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      <Users size={12} strokeWidth={1.7} /> Соисполнители
                    </p>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {(task.accompliceIds || []).map((id) => (
                        <Chip
                          key={id}
                          size="md"
                          removable
                          removeLabel="Удалить соисполнителя"
                          onRemove={() =>
                            void handleUpdateField(
                              'accompliceIds',
                              (task.accompliceIds || []).filter((item) => item !== id),
                            )
                          }
                        >
                          {users.find((user) => user.id === id)?.name || `#${id}`}
                        </Chip>
                      ))}
                    </div>
                    <Popover
                      placement="bottom"
                      className="w-full"
                      trigger={
                        <Button variant="secondary" size="sm" className="w-full justify-start">
                          Выбрать соисполнителей…
                        </Button>
                      }
                    >
                      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                        {memberUsers.map((user) => (
                          <Checkbox
                            key={user.id}
                            checked={(task.accompliceIds || []).includes(user.id)}
                            onChange={(event) =>
                              void handleUpdateField(
                                'accompliceIds',
                                event.target.checked
                                  ? [...new Set([...(task.accompliceIds || []), user.id])]
                                  : (task.accompliceIds || []).filter((id) => id !== user.id),
                              )
                            }
                          >
                            {userLabel(user)}
                          </Checkbox>
                        ))}
                      </div>
                    </Popover>
                  </div>

                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      <Eye size={12} strokeWidth={1.7} /> Наблюдатели
                    </p>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {(task.auditorIds || []).map((id) => (
                        <Chip
                          key={id}
                          size="md"
                          removable
                          removeLabel="Удалить наблюдателя"
                          onRemove={() =>
                            void handleUpdateField(
                              'auditorIds',
                              (task.auditorIds || []).filter((item) => item !== id),
                            )
                          }
                        >
                          {users.find((user) => user.id === id)?.name || `#${id}`}
                        </Chip>
                      ))}
                    </div>
                    <Popover
                      placement="bottom"
                      className="w-full"
                      trigger={
                        <Button variant="secondary" size="sm" className="w-full justify-start">
                          Выбрать наблюдателей…
                        </Button>
                      }
                    >
                      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                        {memberUsers.map((user) => (
                          <Checkbox
                            key={user.id}
                            checked={(task.auditorIds || []).includes(user.id)}
                            onChange={(event) =>
                              void handleUpdateField(
                                'auditorIds',
                                event.target.checked
                                  ? [...new Set([...(task.auditorIds || []), user.id])]
                                  : (task.auditorIds || []).filter((id) => id !== user.id),
                              )
                            }
                          >
                            {userLabel(user)}
                          </Checkbox>
                        ))}
                      </div>
                    </Popover>
                  </div>

                  {/* Priority */}
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      <Flag size={12} strokeWidth={1.7} /> Приоритет
                    </p>
                    {editingField === 'priority' ? (
                      <SelectField
                        variant="boxed"
                        aria-label="Приоритет"
                        value={task.priority}
                        onChange={(event) => void handleUpdateField('priority', event.target.value)}
                        options={priorityOptions}
                      />
                    ) : (
                      <p
                        className={`-mx-1 cursor-pointer rounded-ui px-1 py-0.5 text-sm font-medium hover:bg-surface-2 ${PRIORITY_LABELS[task.priority]?.color}`}
                        onClick={() => setEditingField('priority')}
                      >
                        {PRIORITY_LABELS[task.priority]?.label}
                      </p>
                    )}
                  </div>

                  {/* Deadline */}
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      <Calendar size={12} strokeWidth={1.7} /> Дедлайн
                    </p>
                    {editingField === 'deadline' ? (
                      <TextField
                        variant="boxed"
                        type="datetime-local"
                        value={toLocalInputValue(task.dueDate, 'datetime')}
                        onChange={(event) =>
                          void handleUpdateField(
                            'deadline',
                            event.target.value ? new Date(event.target.value).toISOString() : '',
                          )
                        }
                        onBlur={() => setEditingField(null)}
                        aria-label="Дедлайн"
                        autoFocus
                      />
                    ) : (
                      <p
                        className={`-mx-1 cursor-pointer rounded-ui px-1 py-0.5 text-sm font-medium hover:bg-surface-2 ${isOverdue ? 'text-danger-text' : 'text-ink'}`}
                        onClick={() => setEditingField('deadline')}
                      >
                        {task.dueDate ? formatDate(task.dueDate) : 'Без дедлайна'}
                        {isOverdue && (
                          <AlertTriangle size={12} strokeWidth={1.7} className="ml-1 inline" />
                        )}
                      </p>
                    )}
                  </div>

                  {/* Parent task */}
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      <Layers size={12} strokeWidth={1.7} /> Родительская задача
                    </p>
                    {task.parentId && (
                      <div className="mb-2 flex items-center justify-between rounded-ui border border-line bg-surface-2 px-2 py-1 text-sm">
                        <span className="truncate">
                          {tasks.find((candidate) => candidate.id === task.parentId)?.title ||
                            `#${task.parentId}`}
                        </span>
                        <IconButton
                          label="Убрать родительскую задачу"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleUpdateField('parentId', '')}
                        >
                          <X size={14} strokeWidth={1.7} />
                        </IconButton>
                      </div>
                    )}
                    <div className="relative">
                      <TextField
                        variant="underline"
                        value={parentQuery}
                        onChange={(event) => setParentQuery(event.target.value)}
                        placeholder="Найти задачу по названию или ID…"
                        aria-label="Найти задачу по названию или ID"
                      />
                      {parentQuery && (
                        <div className="absolute z-menu mt-1 max-h-48 w-full overflow-y-auto rounded-ui border border-line bg-canvas p-1 shadow-overlay">
                          {parentSearchResults
                            .filter(
                              (candidate) =>
                                candidate.id !== task.id &&
                                !taskSubtasks.some((subtask) => subtask.id === candidate.id),
                            )
                            .slice(0, 10)
                            .map((candidate) => (
                              <Button
                                key={candidate.id}
                                variant="quiet"
                                size="sm"
                                className="h-auto w-full justify-start px-2 py-1.5 text-left"
                                onClick={() => {
                                  void handleUpdateField('parentId', candidate.id);
                                  setParentQuery('');
                                }}
                              >
                                #{candidate.id}, {candidate.title}
                              </Button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Time Tracking */}
            <Card padding="none" className="overflow-hidden">
              <Button
                onClick={() => setShowTimeEntry(!showTimeEntry)}
                variant="quiet"
                size="sm"
                className="h-auto w-full justify-start gap-2 px-4 py-3"
                icon={<Clock size={14} strokeWidth={1.7} className="text-ink-faint" />}
                trailing={
                  showTimeEntry ? (
                    <ChevronUp size={14} strokeWidth={1.7} className="text-ink-faint" />
                  ) : (
                    <ChevronDown size={14} strokeWidth={1.7} className="text-ink-faint" />
                  )
                }
              >
                Время
              </Button>

              {showTimeEntry && (
                <div className="space-y-3 p-4">
                  <TextField
                    variant="underline"
                    type="number"
                    step="0.5"
                    min="0.5"
                    placeholder="Часы (ч)"
                    aria-label="Часы (ч)"
                    value={timeHours}
                    onChange={(event) => setTimeHours(Number(event.target.value))}
                  />
                  <TextField
                    variant="underline"
                    type="text"
                    placeholder="Что вы сделали?"
                    aria-label="Что вы сделали?"
                    value={timeDesc}
                    onChange={(event) => setTimeDesc(event.target.value)}
                  />
                  <Button full onClick={() => void handleAddTime()}>
                    {editingTimeEntryId ? 'Сохранить время' : 'Записать время'}
                  </Button>
                  {editingTimeEntryId && (
                    <Button
                      full
                      variant="quiet"
                      onClick={() => {
                        setEditingTimeEntryId(null);
                        setTimeHours(1);
                        setTimeDesc('');
                        setShowTimeEntry(false);
                      }}
                    >
                      Отмена
                    </Button>
                  )}
                </div>
              )}

              <div className="space-y-2 p-4">
                {task.timeEntries.map((entry) => (
                  <div key={entry.id} className="rounded-ui bg-surface-2 p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-info-text">{entry.hours} ч</span>
                      <span className="text-whisper text-ink-faint">{entry.date}</span>
                      <span className="flex items-center gap-1">
                        <IconButton
                          label="Изменить запись времени"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingTimeEntryId(entry.id);
                            setTimeHours(entry.hours);
                            setTimeDesc(entry.description);
                            setShowTimeEntry(true);
                          }}
                        >
                          <Pencil size={13} strokeWidth={1.7} />
                        </IconButton>
                        <IconButton
                          label="Удалить запись времени"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDeleteTime(entry.id)}
                        >
                          <Trash2 size={13} strokeWidth={1.7} />
                        </IconButton>
                      </span>
                    </div>
                    {entry.description && (
                      <p className="mt-1 text-whisper text-ink-faint">{entry.description}</p>
                    )}
                  </div>
                ))}

                <div className="space-y-1 border-t border-line pt-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-soft">План, ч:</span>
                    {editingField === 'estimate' ? (
                      <TextField
                        variant="underline"
                        size="sm"
                        type="number"
                        min="0"
                        step="0.5"
                        className="w-24 [&_input]:text-right"
                        aria-label="План, ч"
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        onBlur={() =>
                          void handleUpdateField('estimate', parseFloat(editValue) || 0)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter')
                            void handleUpdateField('estimate', parseFloat(editValue) || 0);
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="font-medium text-ink hover:underline"
                        onClick={() => {
                          setEditValue(String(task.estimate));
                          setEditingField('estimate');
                        }}
                      >
                        {task.estimate} ч
                      </button>
                    )}
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-soft">Факт, ч:</span>
                    <span
                      className={`font-medium ${
                        task.actualTime > task.estimate ? 'text-danger-text' : 'text-success-text'
                      }`}
                    >
                      {task.actualTime} ч
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        <Card padding="none" className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <ClipboardCheck size={14} strokeWidth={1.7} className="text-ink-faint" /> Результаты
            </h3>
            <Badge tone="neutral" className="tabular-nums">
              {(task.results || []).length}
            </Badge>
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto bg-surface-2/40 p-3 sm:p-4">
            {(task.results || []).length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-soft">
                Результатов пока нет в этой вкладке.
                <br />
                Полную историю смотрите в Битриксе — список из приложения не читается.
              </p>
            ) : (
              (task.results || []).map((resultItem) => (
                <article
                  key={resultItem.id}
                  className="flex gap-3 rounded-ui border border-line bg-canvas p-3 shadow-rest"
                >
                  <Avatar name={resultItem.authorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-bold text-ink">{resultItem.authorName}</span>
                      {resultItem.createdAt && (
                        <time className="text-whisper text-ink-faint">
                          {formatDate(resultItem.createdAt)}
                        </time>
                      )}
                    </div>
                    {editingResultId === resultItem.id ? (
                      <div className="space-y-2">
                        <TextArea
                          variant="boxed"
                          autoFocus
                          value={editingResultText}
                          onChange={(event) => setEditingResultText(event.target.value)}
                          rows={3}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => void handleUpdateResult(resultItem.id)}>
                            Сохранить
                          </Button>
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => setEditingResultId(null)}
                          >
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="break-words text-sm leading-relaxed text-ink">
                        <BitrixText text={resultItem.text} />
                      </div>
                    )}
                  </div>
                  {resultItem.authorId === currentUser.id && editingResultId !== resultItem.id && (
                    <div className="flex shrink-0 gap-1">
                      <IconButton
                        label="Изменить результат"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingResultId(resultItem.id);
                          setEditingResultText(resultItem.text);
                        }}
                      >
                        <Pencil size={14} strokeWidth={1.7} />
                      </IconButton>
                      <IconButton
                        label="Удалить результат"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDeleteResult(resultItem.id)}
                      >
                        <Trash2 size={14} strokeWidth={1.7} />
                      </IconButton>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
          <div className="border-t border-line p-3 sm:p-4">
            <div className="flex items-end gap-2">
              <TextArea
                variant="boxed"
                value={taskResultText}
                onChange={(event) => setTaskResultText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void handleAddResult();
                  }
                }}
                placeholder="Что сделано… Shift+Enter — сохранить"
                aria-label="Новый результат"
                rows={3}
                className="min-h-24 flex-1"
              />
              <Button
                onClick={() => void handleAddResult()}
                disabled={!taskResultText.trim() || isSendingResult}
                className="h-9 shrink-0 gap-2"
                icon={<ClipboardCheck size={16} strokeWidth={1.7} />}
                aria-label="Сохранить результат"
              >
                <span className="hidden sm:inline">Сохранить</span>
              </Button>
            </div>
            {resultError && <p className="mt-2 text-sm text-danger-text">{resultError}</p>}
          </div>
        </Card>

        <Card padding="none" className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <MessageSquare size={14} strokeWidth={1.7} className="text-ink-faint" /> Комментарии
            </h3>
            <Badge tone="neutral" className="tabular-nums">
              {task.comments.length}
            </Badge>
          </div>
          <div
            ref={commentsRef}
            className="max-h-80 space-y-3 overflow-y-auto bg-surface-2/40 p-3 sm:p-4"
          >
            {isLoadingTask && task.comments.length === 0 ? (
              <LoadingState className="min-h-24 bg-transparent" />
            ) : task.comments.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-soft">Комментариев пока нет</p>
            ) : (
              task.comments.map((commentItem) =>
                commentItem.isSystem ? (
                  <div
                    key={commentItem.id}
                    className="rounded-ui border border-dashed border-line bg-canvas px-3 py-2 text-sm text-ink-soft"
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-whisper font-bold text-ink-faint">
                      <Settings2 size={13} strokeWidth={1.7} /> Система
                      <span className="font-normal">от {formatDate(commentItem.createdDate)}</span>
                    </div>
                    <div className="leading-relaxed text-ink-soft">
                      <BitrixText text={commentItem.text} />
                      <FileAttachments files={commentItem.files} />
                    </div>
                  </div>
                ) : (
                  <article
                    key={commentItem.id}
                    className="flex gap-3 rounded-ui border border-line bg-canvas p-3 shadow-rest"
                  >
                    <Avatar name={commentItem.authorName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-bold text-ink">{commentItem.authorName}</span>
                        <time className="text-whisper text-ink-faint">
                          {formatDate(commentItem.createdDate)}
                        </time>
                      </div>
                      <div className="break-words text-sm leading-relaxed text-ink">
                        <BitrixText text={commentItem.text} />
                        <FileAttachments files={commentItem.files} />
                      </div>
                    </div>
                  </article>
                ),
              )
            )}
          </div>
          <div className="border-t border-line p-3 sm:p-4">
            <div className="flex items-end gap-2">
              <div className="relative flex-1">
                <TextArea
                  variant="boxed"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void handleAddComment();
                    }
                  }}
                  placeholder="Написать комментарий… Shift+Enter — отправить, @ — упомянуть"
                  aria-label="Комментарий"
                  rows={3}
                  className="min-h-24"
                />
                {mentionUsers.length > 0 && (
                  <div className="absolute bottom-full left-0 z-menu mb-1 w-full rounded-ui border border-line bg-canvas p-1 shadow-overlay">
                    {mentionUsers.map((user) => (
                      <Button
                        key={user.id}
                        variant="quiet"
                        size="sm"
                        className="h-auto w-full justify-start px-2 py-1.5"
                        onClick={() =>
                          setComment((text) =>
                            text.replace(/@[^\s]*$/, `[USER=${user.id}]${user.name}[/USER] `),
                          )
                        }
                      >
                        {user.name}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                onClick={() => void handleAddComment()}
                disabled={!comment.trim() || isSendingComment}
                className="h-9 shrink-0 gap-2"
                icon={<Send size={16} strokeWidth={1.7} />}
                // На узком экране остаётся одна иконка — подпись нужна вслух.
                aria-label="Отправить комментарий"
              >
                <span className="hidden sm:inline">Отправить</span>
              </Button>
            </div>
            {commentError && <p className="mt-2 text-sm text-danger-text">{commentError}</p>}
          </div>
        </Card>

        <Modal
          open={Boolean(focusConflict)}
          onClose={() => setFocusConflict(null)}
          title="Уже есть задача в работе"
          description={focusConflict ? `«${focusConflict.title}»` : ''}
          size="md"
          footer={
            <>
              <Button variant="secondary" onClick={openFocusConflict}>
                Открыть задачу
              </Button>
              <Button onClick={() => void confirmFocusChange()}>Приостановить и начать</Button>
            </>
          }
        >
          {focusConflict && (
            <p className="text-sm text-ink-soft">
              Проект:{' '}
              {projects.find((project) => project.id === focusConflict.projectId)?.name ||
                'Без проекта'}
            </p>
          )}
        </Modal>
      </Modal>
    </>
  );
}
