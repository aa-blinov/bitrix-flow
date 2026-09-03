'use client';
import { Bx24User, BxTask, PRIORITY_LABELS, STATUS_LABELS } from '@/types/bitrix';
import { useKanbanStore } from '@/store/kanban';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  User,
  Users,
  Eye,
  Flag,
  Calendar,
  Timer,
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import LoadingState from '@/components/LoadingState';
import BitrixText from '@/components/BitrixText';
import { formatBitrixDateTime } from '@/lib/bitrix-markup';
import { extractTaskTags } from '@/lib/task-tags';
import { fetchProjectMembers, fetchTaskById, searchProjectTasks } from '@/lib/bitrix24';
import type { Bx24Task } from '@/lib/bitrix24';

export default function TaskModal({ task, onClose }: { task: BxTask; onClose: () => void }) {
  const {
    updateTaskField,
    currentUser,
    moveTaskToProject,
    addComment,
    addTimeEntry,
    users,
    projects,
    tasks,
    allTasks,
    loadAllTasks,
    subtasks,
    loadSubtasks,
    createTask,
    moveTask,
    moveTaskToStage,
    stages,
    addChecklistItem,
    setChecklistItemCompleted,
    deleteChecklistItem,
    isLoadingTask,
  } = useKanbanStore();

  const router = useRouter();
  const [comment, setComment] = useState('');
  const [isSendingComment, setIsSendingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [showTimeEntry, setShowTimeEntry] = useState(false);
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
  const [activeChecklistId, setActiveChecklistId] = useState<string | null>(null);
  const [parentQuery, setParentQuery] = useState('');
  const [parentSearchResults, setParentSearchResults] = useState<Bx24Task[]>([]);
  const [existingSubtaskResults, setExistingSubtaskResults] = useState<Bx24Task[]>([]);
  const [projectMemberIds, setProjectMemberIds] = useState<string[]>([]);
  const [allowedActions, setAllowedActions] = useState<Record<string, boolean> | null>(
    task.actions || null,
  );
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
  const taskTags = extractTaskTags(task.title, task.description);
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
  }, [task.id]);

  const can = (action: string) => allowedActions?.[action] === true;

  const handleUpdateField = async (field: string, value: any) => {
    try {
      setFieldError(null);
      await updateTaskField(task.id, field, value);
      setEditingField(null);
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : 'Не удалось сохранить изменения');
    }
  };

  const handleStartTask = async () => {
    // The project board may not contain the user's task from another project.
    // Load the complete task list before applying the single-focus interaction.
    if (allTasks.length === 0) await loadAllTasks();
    const knownTasks = new Map(
      [...tasks, ...useKanbanStore.getState().allTasks].map((item) => [item.id, item]),
    );
    const activeTask = [...knownTasks.values()].find(
      (item) =>
        item.id !== task.id &&
        item.status === 'in_progress' &&
        String(item.assigneeId) === String(currentUser.id),
    );

    if (activeTask) {
      const approved = window.confirm(
        `Сейчас в работе «${activeTask.title}». Приостановить её и начать эту задачу?`,
      );
      if (!approved) return;

      try {
        setFieldError(null);
        await updateTaskField(activeTask.id, 'status', 'new');
        await updateTaskField(task.id, 'status', 'in_progress');
      } catch (error) {
        setFieldError(error instanceof Error ? error.message : 'Не удалось изменить статус');
      }
      return;
    }

    await handleUpdateField('status', 'in_progress');
  };

  const handleMoveProject = async (projectId: string) => {
    await moveTaskToProject(task.id, projectId);
    onClose();
    router.push(`/projects/${projectId}`);
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

  const handleAddTime = async () => {
    if (timeHours > 0) {
      await addTimeEntry(task.id, timeHours, timeDesc);
      setTimeHours(1);
      setTimeDesc('');
      setShowTimeEntry(false);
    }
  };

  const handleAddChecklistItem = async (parentId = activeChecklistId) => {
    if (!newChecklistItem.trim()) return;
    await addChecklistItem(task.id, newChecklistItem.trim(), parentId || undefined);
    setNewChecklistItem('');
  };

  const handleAddSubtask = async () => {
    if (newSubtaskTitle.trim()) {
      await createTask({
        title: newSubtaskTitle,
        parentId: task.id,
      });
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        className="top-0 left-0 h-dvh w-dvw max-h-none max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none p-0 lg:left-auto lg:right-0 lg:flex lg:w-[60rem] lg:max-w-[calc(100vw-4rem)] lg:flex-col lg:gap-0 lg:overflow-hidden lg:rounded-l-xl"
      >
        {fieldError && (
          <p
            className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {fieldError}
          </p>
        )}
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted flex-shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm text-muted-foreground font-mono">#{task.id}</span>
            <Badge variant="outline" className="shrink-0">
              {STATUS_LABELS[task.status] || task.status}
            </Badge>
            <div className="flex shrink-0 items-center gap-1">
              {(task.status === 'new' || task.status === 'deferred') && (
                <>
                  {can('start') && (
                    <Button size="sm" onClick={() => void handleStartTask()}>
                      <Play /> {task.status === 'deferred' ? 'Продолжить' : 'Начать'}
                    </Button>
                  )}
                  {task.status === 'new' && can('defer') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleUpdateField('status', 'deferred')}
                    >
                      <Clock3 /> Отложить
                    </Button>
                  )}
                </>
              )}
              {task.status === 'in_progress' && (
                <>
                  {can('pause') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleUpdateField('status', 'new')}
                    >
                      <Pause /> Приостановить
                    </Button>
                  )}
                  {can('defer') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleUpdateField('status', 'deferred')}
                    >
                      <Clock3 /> Отложить
                    </Button>
                  )}
                  {can('complete') && (
                    <Button size="sm" onClick={() => void handleUpdateField('status', 'done')}>
                      <CircleCheck /> Завершить
                    </Button>
                  )}
                </>
              )}
              {task.status === 'testing' && (
                <>
                  {can('defer') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleUpdateField('status', 'deferred')}
                    >
                      <Clock3 /> Отложить
                    </Button>
                  )}
                  {can('complete') && (
                    <Button size="sm" onClick={() => void handleUpdateField('status', 'done')}>
                      <CircleCheck /> Завершить
                    </Button>
                  )}
                </>
              )}
              {task.status === 'done' && can('renew') && (
                <Button size="sm" onClick={() => void handleUpdateField('status', 'new')}>
                  <RotateCcw /> Возобновить
                </Button>
              )}
            </div>
            {projectStages.length > 0 && (
              <Select
                value={selectedStageId}
                onValueChange={(stageId) => void moveTaskToStage(task.id, stageId)}
              >
                <SelectTrigger className="w-40">
                  <Layers size={14} className="mr-1 shrink-0" />
                  <SelectValue placeholder="Фаза" />
                </SelectTrigger>
                <SelectContent>
                  {projectStages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={20} />
          </Button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Main */}
            <div className="md:col-span-2 space-y-4">
              {/* Title */}
              <div>
                {editingField === 'title' ? (
                  <Input
                    className="h-10 text-lg font-semibold"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => handleUpdateField('title', editValue)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUpdateField('title', editValue)}
                    autoFocus
                  />
                ) : (
                  <h2
                    className="text-lg font-semibold text-foreground cursor-pointer hover:bg-muted rounded-lg px-4 py-2 -mx-4"
                    onClick={() => {
                      setEditingField('title');
                      setEditValue(task.title);
                    }}
                  >
                    {task.title}
                  </h2>
                )}
              </div>

              {/* Description */}
              <div>
                <h3 className="text-xs uppercase text-muted-foreground font-medium mb-2">
                  Описание
                </h3>
                {editingField === 'description' ? (
                  <Textarea
                    className="min-h-24 resize-none"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => handleUpdateField('description', editValue)}
                    rows={3}
                    autoFocus
                  />
                ) : (
                  <div
                    className="text-foreground/80 cursor-pointer hover:bg-muted rounded-lg p-3 min-h-[50px]"
                    onClick={() => {
                      setEditingField('description');
                      setEditValue(task.description);
                    }}
                  >
                    {task.description ? (
                      <BitrixText text={task.description} />
                    ) : (
                      <span className="text-muted-foreground">Добавить описание…</span>
                    )}
                  </div>
                )}
              </div>

              {taskTags.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Теги</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {taskTags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Subtasks - Collapsible */}
              <Card className="gap-0 py-0">
                <Button
                  onClick={() => setShowSubtasks(!showSubtasks)}
                  variant="ghost"
                  className="h-auto w-full justify-between rounded-none px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <CheckSquare size={16} className="text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      Подзадачи ({taskSubtasks.length})
                    </span>
                  </div>
                  {showSubtasks ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </Button>

                {showSubtasks && (
                  <div className="p-3 space-y-2">
                    {taskSubtasks.map((sub) => (
                      <div key={sub.id} className="flex items-center gap-3 p-2 bg-muted rounded-lg">
                        <GripVertical size={14} className="text-muted-foreground/70" />
                        <Button
                          onClick={() => moveTask(sub.id, sub.status === 'done' ? 'new' : 'done')}
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-emerald-600"
                        >
                          {sub.status === 'done' ? (
                            <CheckSquare size={16} className="text-green-500" />
                          ) : (
                            <Square size={16} />
                          )}
                        </Button>
                        <span
                          className={`flex-1 text-sm ${sub.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                        >
                          {sub.title}
                        </span>
                        <span className="text-xs text-muted-foreground">#{sub.id}</span>
                      </div>
                    ))}

                    {showSubtaskAdd ? (
                      <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
                        <Square size={16} className="text-muted-foreground/70" />
                        <Input
                          type="text"
                          value={newSubtaskTitle}
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          placeholder="Название подзадачи…"
                          className="h-8 flex-1 text-sm"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && void handleAddSubtask()}
                        />
                        <Button
                          onClick={() => void handleAddSubtask()}
                          variant="ghost"
                          size="icon-xs"
                        >
                          <Plus size={16} />
                        </Button>
                        <Button
                          onClick={() => setShowSubtaskAdd(false)}
                          variant="ghost"
                          size="icon-xs"
                        >
                          <X size={16} />
                        </Button>
                      </div>
                    ) : showExistingSubtaskPicker ? (
                      <div className="relative rounded-lg bg-muted p-2">
                        <Input
                          value={existingSubtaskQuery}
                          onChange={(event) => setExistingSubtaskQuery(event.target.value)}
                          placeholder="Найти существующую задачу…"
                          className="h-8"
                          autoFocus
                        />
                        {existingSubtaskQuery && (
                          <div className="mt-2 max-h-40 overflow-y-auto rounded border bg-background p-1">
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
                                  variant="ghost"
                                  className="h-auto w-full justify-start px-2 py-1.5 text-left"
                                  onClick={() => void handleAttachExistingSubtask(candidate.id)}
                                >
                                  <span className="truncate">
                                    #{candidate.id}, {candidate.title}
                                  </span>
                                </Button>
                              ))}
                          </div>
                        )}
                        <Button
                          onClick={() => {
                            setExistingSubtaskQuery('');
                            setShowExistingSubtaskPicker(false);
                          }}
                          variant="ghost"
                          className="mt-1 h-7 w-full text-xs"
                        >
                          Отмена
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => setShowExistingSubtaskPicker(true)}
                          variant="outline"
                          className="flex-1"
                        >
                          <Plus size={14} />
                          Выбрать существующую
                        </Button>
                        <Button
                          onClick={() => setShowSubtaskAdd(true)}
                          variant="ghost"
                          className="flex-1 text-muted-foreground"
                        >
                          <Plus size={14} />
                          Создать новую
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card className="gap-0 py-0">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckSquare size={16} /> Чек-лист (
                    {task.checklist?.filter((item) => item.completed).length || 0}/
                    {task.checklist?.length || 0})
                  </div>
                </div>
                <div className="space-y-3 px-4 pb-3">
                  {task.checklist
                    ?.filter((item) => item.parentId === '0')
                    .map((list) => (
                      <div key={list.id} className="rounded-lg border bg-muted/30 p-2">
                        <div className="px-1 text-sm font-medium">{list.title}</div>
                        {task.checklist
                          ?.filter((item) => item.parentId === list.id)
                          .map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                            >
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={
                                  item.completed ? 'Отметить незавершённым' : 'Отметить выполненным'
                                }
                                onClick={() =>
                                  void setChecklistItemCompleted(task.id, item.id, !item.completed)
                                }
                              >
                                {item.completed ? (
                                  <CheckSquare className="text-primary" />
                                ) : (
                                  <Square />
                                )}
                              </Button>
                              <span
                                className={`min-w-0 flex-1 text-sm ${item.completed ? 'text-muted-foreground line-through' : ''}`}
                              >
                                {item.title}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Удалить пункт"
                                onClick={() => void deleteChecklistItem(task.id, item.id)}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          ))}
                        <div className="mt-2 flex gap-2">
                          <Input
                            value={activeChecklistId === list.id ? newChecklistItem : ''}
                            onFocus={() => setActiveChecklistId(list.id)}
                            onChange={(event) => {
                              setActiveChecklistId(list.id);
                              setNewChecklistItem(event.target.value);
                            }}
                            placeholder="Добавить пункт…"
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
                  <div className="flex gap-2 border-t pt-3">
                    <Input
                      value={activeChecklistId === null ? newChecklistItem : ''}
                      onFocus={() => setActiveChecklistId(null)}
                      onChange={(event) => {
                        setActiveChecklistId(null);
                        setNewChecklistItem(event.target.value);
                      }}
                      placeholder="Название нового чек-листа…"
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
            <div className="space-y-4">
              {/* Properties - Collapsible */}
              <Card className="gap-0 py-0">
                <Button
                  onClick={() => setShowDetails(!showDetails)}
                  variant="ghost"
                  className="h-auto w-full justify-between rounded-none px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Детали</span>
                  </div>
                  {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </Button>

                {showDetails && (
                  <div className="p-4 space-y-4">
                    <div>
                      <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Layers size={12} /> Проект
                      </label>
                      <Select
                        value={task.projectId || 'none'}
                        onValueChange={(value) => value !== 'none' && void handleMoveProject(value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Без проекта" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Без проекта</SelectItem>
                          {projects
                            .filter((project) => !project.isArchived)
                            .map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Assignee */}
                    <div>
                      <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                        <User size={12} /> Исполнитель
                      </label>
                      {editingField === 'assigneeId' ? (
                        <Select
                          value={task.assigneeId || 'unassigned'}
                          onValueChange={(value) =>
                            handleUpdateField('assigneeId', value === 'unassigned' ? '' : value)
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Не назначен</SelectItem>
                            {users.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {userLabel(u)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p
                          className="font-medium text-foreground cursor-pointer hover:bg-muted rounded px-1 -mx-1"
                          onClick={() => setEditingField('assigneeId')}
                        >
                          {task.assigneeName || 'Не назначен'}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Users size={12} /> Соисполнители
                      </label>
                      <div className="mb-1 flex flex-wrap gap-1">
                        {(task.accompliceIds || []).map((id) => (
                          <Badge key={id} variant="secondary" className="gap-1 pr-1">
                            {users.find((user) => user.id === id)?.name || `#${id}`}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-4"
                              aria-label="Удалить соисполнителя"
                              onClick={() =>
                                void handleUpdateField(
                                  'accompliceIds',
                                  (task.accompliceIds || []).filter((item) => item !== id),
                                )
                              }
                            >
                              <X size={11} />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            className="h-8 w-full justify-start font-normal"
                          >
                            Выбрать соисполнителей…
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="max-h-64 w-64 overflow-y-auto"
                        >
                          {users
                            .filter((user) => projectMemberIds.includes(user.id))
                            .map((user) => (
                              <DropdownMenuCheckboxItem
                                key={user.id}
                                checked={(task.accompliceIds || []).includes(user.id)}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(checked) =>
                                  void handleUpdateField(
                                    'accompliceIds',
                                    checked
                                      ? [...new Set([...(task.accompliceIds || []), user.id])]
                                      : (task.accompliceIds || []).filter((id) => id !== user.id),
                                  )
                                }
                              >
                                {userLabel(user)}
                              </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div>
                      <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Eye size={12} /> Наблюдатели
                      </label>
                      <div className="mb-1 flex flex-wrap gap-1">
                        {(task.auditorIds || []).map((id) => (
                          <Badge key={id} variant="secondary" className="gap-1 pr-1">
                            {users.find((user) => user.id === id)?.name || `#${id}`}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-4"
                              aria-label="Удалить наблюдателя"
                              onClick={() =>
                                void handleUpdateField(
                                  'auditorIds',
                                  (task.auditorIds || []).filter((item) => item !== id),
                                )
                              }
                            >
                              <X size={11} />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            className="h-8 w-full justify-start font-normal"
                          >
                            Выбрать наблюдателей…
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="max-h-64 w-64 overflow-y-auto"
                        >
                          {users
                            .filter((user) => projectMemberIds.includes(user.id))
                            .map((user) => (
                              <DropdownMenuCheckboxItem
                                key={user.id}
                                checked={(task.auditorIds || []).includes(user.id)}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(checked) =>
                                  void handleUpdateField(
                                    'auditorIds',
                                    checked
                                      ? [...new Set([...(task.auditorIds || []), user.id])]
                                      : (task.auditorIds || []).filter((id) => id !== user.id),
                                  )
                                }
                              >
                                {userLabel(user)}
                              </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Priority */}
                    <div>
                      <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                        <Flag size={12} /> Приоритет
                      </label>
                      {editingField === 'priority' ? (
                        <Select
                          value={task.priority}
                          onValueChange={(value) => handleUpdateField('priority', value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {priorityOptions.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p
                          className={`font-medium cursor-pointer hover:bg-muted rounded px-1 -mx-1 ${PRIORITY_LABELS[task.priority]?.color}`}
                          onClick={() => setEditingField('priority')}
                        >
                          {PRIORITY_LABELS[task.priority]?.label}
                        </p>
                      )}
                    </div>

                    {/* Deadline */}
                    <div>
                      <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                        <Calendar size={12} /> Дедлайн
                      </label>
                      {editingField === 'deadline' ? (
                        <Input
                          type="datetime-local"
                          className="w-full"
                          value={task.dueDate ? task.dueDate.slice(0, 16) : ''}
                          onChange={(e) =>
                            handleUpdateField(
                              'deadline',
                              e.target.value ? new Date(e.target.value).toISOString() : '',
                            )
                          }
                          onBlur={() => setEditingField(null)}
                          autoFocus
                        />
                      ) : (
                        <p
                          className={`font-medium cursor-pointer hover:bg-muted rounded px-1 -mx-1 ${isOverdue ? 'text-red-500' : 'text-foreground'}`}
                          onClick={() => setEditingField('deadline')}
                        >
                          {task.dueDate ? formatDate(task.dueDate) : 'Без дедлайна'}
                          {isOverdue && <AlertTriangle size={12} className="inline ml-1" />}
                        </p>
                      )}
                    </div>

                    {/* Parent task */}
                    <div>
                      <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Layers size={12} /> Родительская задача
                      </label>
                      {task.parentId && (
                        <div className="mb-1 flex items-center justify-between rounded border bg-muted px-2 py-1 text-sm">
                          <span className="truncate">
                            {tasks.find((candidate) => candidate.id === task.parentId)?.title ||
                              `#${task.parentId}`}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Убрать родительскую задачу"
                            onClick={() => void handleUpdateField('parentId', '')}
                          >
                            <X />
                          </Button>
                        </div>
                      )}
                      <div className="relative">
                        <Input
                          value={parentQuery}
                          onChange={(event) => setParentQuery(event.target.value)}
                          placeholder="Найти задачу по названию или ID…"
                        />
                        {parentQuery && (
                          <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
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
                                  variant="ghost"
                                  className="h-auto w-full justify-start px-2 py-1.5 text-left"
                                  onClick={() => {
                                    void handleUpdateField('parentId', candidate.id);
                                    setParentQuery('');
                                  }}
                                >
                                  <span className="truncate">
                                    #{candidate.id}, {candidate.title}
                                  </span>
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
              <Card className="gap-0 py-0">
                <Button
                  onClick={() => setShowTimeEntry(!showTimeEntry)}
                  variant="ghost"
                  className="h-auto w-full justify-between rounded-none px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Время</span>
                  </div>
                  {showTimeEntry ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </Button>

                {showTimeEntry && (
                  <div className="p-4 space-y-3">
                    <Input
                      type="number"
                      step="0.5"
                      min="0.5"
                      placeholder="Часы (ч)"
                      value={timeHours}
                      onChange={(e) => setTimeHours(Number(e.target.value))}
                      className="w-full"
                    />
                    <Input
                      type="text"
                      placeholder="Что вы сделали?"
                      value={timeDesc}
                      onChange={(e) => setTimeDesc(e.target.value)}
                      className="w-full"
                    />
                    <Button onClick={handleAddTime} className="w-full">
                      Записать время
                    </Button>
                  </div>
                )}

                <div className="px-4 pb-4 space-y-2">
                  {task.timeEntries.slice(0, 3).map((entry) => (
                    <div key={entry.id} className="text-sm bg-muted rounded-lg p-2">
                      <div className="flex justify-between">
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          {entry.hours} ч
                        </span>
                        <span className="text-muted-foreground text-xs">{entry.date}</span>
                      </div>
                      {entry.description && (
                        <p className="text-muted-foreground text-xs mt-1">{entry.description}</p>
                      )}
                    </div>
                  ))}

                  <div className="pt-2 border-t space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">План, ч:</span>
                      {editingField === 'estimate' ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          className="h-7 w-24 text-right"
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
                          className="font-medium hover:underline"
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
                      <span className="text-muted-foreground">Факт, ч:</span>
                      <span
                        className={`font-medium ${task.actualTime > task.estimate ? 'text-red-500' : 'text-green-600'}`}
                      >
                        {task.actualTime} ч
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <Card className="mt-6 gap-0 overflow-hidden py-0">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare size={16} className="text-primary" /> Комментарии
              </h3>
              <Badge variant="secondary" className="font-normal tabular-nums">
                {task.comments.length}
              </Badge>
            </div>
            <div
              ref={commentsRef}
              className="max-h-80 space-y-3 overflow-y-auto bg-muted/20 p-3 sm:p-4"
            >
              {isLoadingTask && task.comments.length === 0 ? (
                <LoadingState className="min-h-24 bg-transparent" />
              ) : task.comments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Комментариев пока нет
                </p>
              ) : (
                task.comments.map((commentItem) =>
                  commentItem.isSystem ? (
                    <div
                      key={commentItem.id}
                      className="rounded-lg border border-dashed bg-background/70 px-3 py-2 text-sm text-muted-foreground"
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <Settings2 size={13} /> Система
                        <span className="font-normal">
                          от {formatDate(commentItem.createdDate)}
                        </span>
                      </div>
                      <div className="leading-relaxed text-foreground/75">
                        <BitrixText text={commentItem.text} />
                      </div>
                    </div>
                  ) : (
                    <article
                      key={commentItem.id}
                      className="flex gap-3 rounded-xl border bg-background p-3 shadow-sm"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {commentItem.authorName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold">{commentItem.authorName}</span>
                          <time className="text-xs text-muted-foreground">
                            {formatDate(commentItem.createdDate)}
                          </time>
                        </div>
                        <div className="break-words text-sm leading-relaxed text-foreground/85">
                          <BitrixText text={commentItem.text} />
                        </div>
                      </div>
                    </article>
                  ),
                )
              )}
            </div>
            <div className="border-t bg-background p-3 sm:p-4">
              <div className="flex items-end gap-2">
                <div className="relative flex-1">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void handleAddComment();
                      }
                    }}
                    placeholder="Написать комментарий… Shift+Enter — отправить, @ — упомянуть"
                    rows={3}
                    className="min-h-24 resize-y bg-muted/30"
                  />
                  {mentionUsers.length > 0 && (
                    <div className="absolute bottom-full left-0 z-20 mb-1 w-full rounded-lg border bg-popover p-1 shadow-md">
                      {mentionUsers.map((user) => (
                        <Button
                          key={user.id}
                          variant="ghost"
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
                  className="h-10 shrink-0 gap-2"
                >
                  <Send size={16} />
                  <span className="hidden sm:inline">Отправить</span>
                </Button>
              </div>
              {commentError && <p className="mt-2 text-sm text-destructive">{commentError}</p>}
            </div>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
