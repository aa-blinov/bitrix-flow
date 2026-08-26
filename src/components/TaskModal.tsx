'use client';
import { BxTask, PRIORITY_LABELS, STATUS_LABELS, TaskStatus } from '@/types/bitrix';
import { useKanbanStore } from '@/store/kanban';
import { useState } from 'react';
import {
  X,
  User,
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

export default function TaskModal({ task, onClose }: { task: BxTask; onClose: () => void }) {
  const {
    updateTaskField,
    addComment,
    addTimeEntry,
    users,
    subtasks,
    loadSubtasks,
    createTask,
    moveTask,
    isLoadingTask,
  } = useKanbanStore();

  const [comment, setComment] = useState('');
  const [showTimeEntry, setShowTimeEntry] = useState(false);
  const [showSubtaskAdd, setShowSubtaskAdd] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [timeHours, setTimeHours] = useState(1);
  const [timeDesc, setTimeDesc] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showSubtasks, setShowSubtasks] = useState(true);
  const [showDetails, setShowDetails] = useState(true);

  const taskSubtasks = subtasks[task.id] || [];

  const handleUpdateField = async (field: string, value: any) => {
    await updateTaskField(task.id, field, value);
    setEditingField(null);
  };

  const handleAddComment = () => {
    if (comment.trim()) {
      addComment(task.id, comment);
      setComment('');
    }
  };

  const handleAddTime = () => {
    if (timeHours > 0) {
      addTimeEntry(task.id, timeHours, timeDesc);
      setTimeHours(1);
      setTimeDesc('');
      setShowTimeEntry(false);
    }
  };

  const handleAddSubtask = async () => {
    if (newSubtaskTitle.trim()) {
      await createTask({
        title: newSubtaskTitle,
        parentId: task.id,
      });
      setNewSubtaskTitle('');
      setShowSubtaskAdd(false);
      loadSubtasks(task.id);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

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
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl overflow-y-auto p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted flex-shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm text-muted-foreground font-mono">#{task.id}</span>
            <Select
              value={task.status}
              onValueChange={(value) => handleUpdateField('status', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['new', 'in_progress', 'testing', 'done'].map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s] || s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={20} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
                <h3 className="text-xs uppercase text-muted-foreground font-medium mb-2">Описание</h3>
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
                    {task.description || (
                      <span className="text-muted-foreground">Добавить описание…</span>
                    )}
                  </div>
                )}
              </div>

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
                      <div
                        key={sub.id}
                        className="flex items-center gap-3 p-2 bg-muted rounded-lg"
                      >
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
                      <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                        <Square size={16} className="text-muted-foreground/70" />
                        <Input
                          type="text"
                          value={newSubtaskTitle}
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          placeholder="Название подзадачи…"
                          className="h-8 flex-1 text-sm"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
                        />
                        <Button onClick={handleAddSubtask} variant="ghost" size="icon-xs">
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
                    ) : (
                      <Button
                        onClick={() => setShowSubtaskAdd(true)}
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                      >
                        <Plus size={14} />
                        Добавить подзадачу
                      </Button>
                    )}
                  </div>
                )}
              </Card>

              {/* Comments */}
              <div>
                <h3 className="text-xs uppercase text-muted-foreground font-medium mb-3 flex items-center gap-2">
                  <MessageSquare size={14} />
                  Комментарии ({task.comments.length})
                </h3>

                <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
                  {isLoadingTask && task.comments.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">Загрузка…</div>
                  ) : (
                    task.comments.map((c) => (
                      <div key={c.id} className="bg-muted rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs flex items-center justify-center font-medium">
                            {c.authorName.charAt(0)}
                          </div>
                          <span className="font-medium text-sm text-foreground">{c.authorName}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(c.createdDate)}</span>
                        </div>
                        <p className="text-foreground/80 text-sm pl-8">{c.text}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-2">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Написать комментарий…"
                    rows={2}
                    className="flex-1 resize-none"
                  />
                  <Button
                    onClick={handleAddComment}
                    disabled={!comment.trim()}
                    size="icon"
                    className="h-auto"
                  >
                    <Send size={16} />
                  </Button>
                </div>
              </div>
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
                                {u.name}
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

                    {/* Estimate */}
                    <div>
                      <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                        <Timer size={12} /> Оценка
                      </label>
                      {editingField === 'estimate' ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          className="w-full"
                          value={task.estimate}
                          onChange={(e) =>
                            handleUpdateField('estimate', parseFloat(e.target.value) || 0)
                          }
                          onBlur={() => setEditingField(null)}
                          autoFocus
                        />
                      ) : (
                        <p
                          className="font-medium text-foreground cursor-pointer hover:bg-muted rounded px-1 -mx-1"
                          onClick={() => setEditingField('estimate')}
                        >
                          {task.estimate > 0 ? `${task.estimate} ч` : 'Без оценки'}
                        </p>
                      )}
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
                      placeholder="Часы"
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
                        <span className="font-medium text-blue-600 dark:text-blue-400">{entry.hours} ч</span>
                        <span className="text-muted-foreground text-xs">{entry.date}</span>
                      </div>
                      {entry.description && (
                        <p className="text-muted-foreground text-xs mt-1">{entry.description}</p>
                      )}
                    </div>
                  ))}

                  <div className="pt-2 border-t space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">План:</span>
                      <span className="font-medium">{task.estimate} ч</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Затрачено:</span>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
