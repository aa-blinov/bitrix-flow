import { AlignLeft, Calendar, MoveHorizontal, Timer } from 'lucide-react';
import { PRIORITY_LABELS, BxTask } from '@/types/bitrix';
import { Avatar } from '@/components/monos/Avatar';
import { Badge, type Tone } from '@/components/monos/Badge';
import { Card } from '@/components/monos/Card';
import { Chip } from '@/components/monos/Chip';
import { IconButton } from '@/components/monos/IconButton';
import { Menu } from '@/components/monos/Menu';
import { extractTaskTags } from '@/lib/task-tags';
import { dateFormat, t } from '@/lib/i18n';

// Форматтеры один раз на модуль: toLocale*String строит новый на каждый
// вызов, а formatDeadline зовётся на каждую карточку доски.
const DAY_MONTH = dateFormat({ month: 'short', day: 'numeric' });
const WEEKDAY = dateFormat({ weekday: 'short' });
const HOUR_MINUTE = dateFormat({ hour: '2-digit', minute: '2-digit' });

function formatDeadline(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    let day = DAY_MONTH.format(date);
    if (diff === 0) day = t('Сегодня');
    else if (diff === 1) day = t('Завтра');
    else if (diff === -1) day = t('Вчера');
    else if (diff > 1 && diff < 7) day = WEEKDAY.format(date);
    else if (diff < 0 && diff > -7) day = WEEKDAY.format(date);

    return `${day}, ${HOUR_MINUTE.format(date)}`;
  } catch {
    return '';
  }
}

// Приоритет — это состояние, а не украшение: цвет приходит из ролей набора.
const PRIORITY_TONES: Record<string, { tone: Tone; className: string }> = {
  low: { tone: 'neutral', className: 'bg-surface-2' },
  medium: { tone: 'neutral', className: 'bg-surface-2' },
  high: { tone: 'warning', className: 'bg-warning/10' },
  critical: { tone: 'danger', className: 'bg-danger/10' },
};

export function TaskCard({
  task,
  avatarUrl,
  onDragStart,
  onClick,
  isDragging,
  stages,
  onMoveToStage,
}: {
  task: BxTask;
  avatarUrl?: string;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: () => void;
  isDragging: boolean;
  stages: Array<{ id: string; name: string }>;
  onMoveToStage: (taskId: string, stageId: string) => void;
}) {
  const priority = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.medium;
  const priorityTone = PRIORITY_TONES[task.priority] || PRIORITY_TONES.medium;
  const taskTags = task.tags?.length ? task.tags : extractTaskTags(task.title, task.description);
  const isCompleted = task.status === 'done';
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';
  const dueDate = formatDeadline(task.dueDate);
  const completedSubtasks = task.subtasks?.filter((s) => s.status === 'done').length || 0;
  const totalSubtasks = task.subtasks?.length || 0;
  // «Обычный» стоит почти на всех задачах: чип на каждой карточке — шум, а не
  // сигнал. Показываем только отличие от нормы.
  const showPriority = task.priority !== 'medium';
  const hasChips = showPriority || taskTags.length > 0 || Boolean(task.parentId);

  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      // Колонка держит до 50 карточек, а видно от силы шесть: content-visibility
      // позволяет браузеру не отрисовывать то, что за пределами экрана. Он же обрезает всё,
      // что вылезает за карточку, поэтому с открытым меню фазы включаем показ целиком.
      className={`group/card cursor-pointer border-transparent p-3 transition-colors [contain-intrinsic-size:auto_132px] [content-visibility:auto] has-[[aria-expanded=true]]:[content-visibility:visible] hover:border-line-strong hover:shadow-lift ${
        isDragging ? 'opacity-40 rotate-1' : isCompleted ? 'bg-surface-2 text-ink-soft' : ''
      }`}
    >
      {/* Открытие задачи — растянутая кнопка под содержимым, а не onClick на div:
          div с onClick недоступен с клавиатуры, а role="button" на карточке
          вложил бы в неё кнопки меню переноса — axe ловит и то, и другое. Кнопка
          идёт первой и позиционирована, поэтому лежит над статичным содержимым,
          но под меню переноса (у него z-10). */}
      <button
        type="button"
        className="absolute inset-0 rounded-ui"
        onClick={onClick}
        aria-label={t('Открыть задачу {0}', task.title)}
      />
      {/* Перенос карточки: HTML5 drag&drop не работает на тач-экранах, поэтому
          фазу можно выбрать и списком. */}
      <div
        className="absolute right-2 top-2 z-10 pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100"
        // Клик по меню не должен открывать карточку.
        onClick={(event) => event.stopPropagation()}
      >
        <Menu
          // Выпадашка рисуется порталом: колонка — скролл-контейнер, и обычный
          // absolute-поповер обрезался её низом, когда меню открывалось
          // на карточке из нижней части длинной колонки.
          portal
          label={t('Переместить в фазу')}
          align="end"
          width="auto"
          items={stages.map((stage) => ({
            value: stage.id,
            label: stage.name,
            disabled: stage.id === task.stageId,
            onSelect: () => onMoveToStage(task.id, stage.id),
          }))}
          trigger={
            <IconButton
              label={t('Переместить задачу {0}', task.title)}
              variant="ghost"
              size="sm"
              onClick={(event) => event.stopPropagation()}
            >
              <MoveHorizontal className="size-4" strokeWidth={1.7} />
            </IconButton>
          }
        />
      </div>
      {hasChips && (
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1 pr-6">
          {showPriority && (
            <Badge
              tone={priorityTone.tone}
              className={`shrink-0 whitespace-nowrap rounded-ui px-1.5 py-0.5 ${priorityTone.className}`}
            >
              {priority.label}
            </Badge>
          )}
          {taskTags.slice(0, 3).map((tag) => (
            <Chip key={tag} title={tag} className="max-w-28">
              {tag}
            </Chip>
          ))}
          {taskTags.length > 3 && <Chip>+{taskTags.length - 3}</Chip>}
          {task.parentId && <Chip tone="accent">{t('Подзадача')}</Chip>}
        </div>
      )}

      {/* Title and description indicator share one row so the icon never changes card height. */}
      <div className={`mb-2 flex items-start gap-1 ${hasChips ? '' : 'pr-6'}`}>
        <h3
          className={`min-w-0 flex-1 text-sm leading-snug line-clamp-2 xl:line-clamp-3 ${
            isCompleted ? 'text-ink-soft line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </h3>
        {task.description && (
          <AlignLeft className="mt-0.5 shrink-0 text-ink-faint" size={14} strokeWidth={1.7} />
        )}
      </div>

      {/* Meta footer — в узких колонках (224px) «План + Факт» не помещаются
          в одну строку с дедлайном и аватаром. Перенос строк и truncate у
          дедлайна/оценки чинят наложение, не ломая внешний вид на широких. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span
            className={`flex min-w-0 items-center gap-1 ${isOverdue ? 'text-danger-text font-medium' : ''}`}
          >
            <Calendar size={12} strokeWidth={1.7} className="shrink-0" />
            <span className="truncate">{dueDate || t('Без срока')}</span>
          </span>
          {(task.estimate > 0 || task.actualTime > 0) && (
            <span className="flex items-center gap-1">
              <Timer size={12} strokeWidth={1.7} className="shrink-0" />
              <span className="truncate">
                {task.estimate > 0 && t('План {0} ч', task.estimate)}
                {task.estimate > 0 && task.actualTime > 0 && ', '}
                {task.actualTime > 0 && t('Факт {0} ч', task.actualTime)}
              </span>
            </span>
          )}
          {totalSubtasks > 0 && (
            <span className="flex items-center gap-1">
              <span aria-hidden>☐</span>
              {completedSubtasks}/{totalSubtasks}
            </span>
          )}
        </div>

        {task.assigneeName && (
          <AssigneeAvatar
            key={avatarUrl || 'no-avatar'}
            name={task.assigneeName}
            avatarUrl={avatarUrl}
          />
        )}
      </div>
    </Card>
  );
}

function AssigneeAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <span title={name} className="inline-flex shrink-0">
      <Avatar name={name} src={avatarUrl} size="xs" />
    </span>
  );
}
