'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import LoadingState from '@/components/LoadingState';
import { formatBitrixDateTime } from '@/lib/bitrix-markup';
import { fetchTaskHistory, secondsToHours, type TaskHistoryEntry } from '@/lib/bitrix24';
import { mapBitrixTaskStatus } from '@/lib/task-status';
import { t } from '@/lib/i18n';
import { useKanbanStore } from '@/store/kanban';
import { STATUS_LABELS } from '@/types/bitrix';

// Геттер, а не таблица на уровне модуля: язык известен только после монтирования.
const fieldLabel = (field: string): string =>
  ({
    NEW: t('Задача создана'),
    TITLE: t('Название'),
    DESCRIPTION: t('Описание'),
    STATUS: t('Статус'),
    PRIORITY: t('Приоритет'),
    DEADLINE: t('Дедлайн'),
    RESPONSIBLE_ID: t('Исполнитель'),
    CREATED_BY: t('Постановщик'),
    ACCOMPLICES: t('Соисполнители'),
    AUDITORS: t('Наблюдатели'),
    GROUP_ID: t('Проект'),
    STAGE: t('Стадия'),
    PARENT_ID: t('Родительская задача'),
    DEPENDS_ON: t('Связанные задачи'),
    TAGS: t('Теги'),
    TIME_ESTIMATE: t('План, ч'),
    TIME_SPENT_IN_LOGS: t('Затраченное время, ч'),
    START_DATE_PLAN: t('Плановое начало'),
    END_DATE_PLAN: t('Плановое завершение'),
    CHECKLIST_ITEM_CREATE: t('Чек-лист: добавлен пункт'),
    CHECKLIST_ITEM_RENAME: t('Чек-лист: пункт переименован'),
    CHECKLIST_ITEM_CHECK: t('Чек-лист: пункт выполнен'),
    CHECKLIST_ITEM_UNCHECK: t('Чек-лист: пункт снова открыт'),
    CHECKLIST_ITEM_REMOVE: t('Чек-лист: пункт удалён'),
    COMMENT: t('Комментарий'),
    FILES: t('Файлы'),
    MARK: t('Оценка'),
    RESULT: t('Добавлен результат'),
    RESULT_EDIT: t('Результат изменён'),
    RESULT_REMOVE: t('Результат удалён'),
  })[field] || field;

// Поля, у которых значение не показываем: длинный текст или ничего не значащая пара.
const WITHOUT_VALUE = new Set(['NEW', 'DESCRIPTION', 'RESULT', 'RESULT_EDIT', 'RESULT_REMOVE']);
const SAME_VALUE = new Set(['CHECKLIST_ITEM_CHECK', 'CHECKLIST_ITEM_UNCHECK']);

export default function TaskHistory({ taskId }: { taskId: string }) {
  const users = useKanbanStore((state) => state.users);
  const projects = useKanbanStore((state) => state.projects);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TaskHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Историю грузим по раскрытию: открытие карточки не должно ждать ещё одного вызова портала.
  const load = () => {
    setFailed(false);
    fetchTaskHistory(taskId)
      .then((list) => setEntries([...list].reverse()))
      .catch(() => setFailed(true));
  };
  const toggle = () => {
    if (!open && !entries) load();
    setOpen(!open);
  };

  const userName = (id: string) => users.find((user) => String(user.id) === id)?.name || `#${id}`;
  const format = (field: string, value: string): string => {
    if (!value) return t('пусто');
    if (field === 'STATUS') {
      const status = mapBitrixTaskStatus(value);
      return STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : value;
    }
    if (field === 'PRIORITY')
      return value === '2' ? t('Высокий') : value === '0' ? t('Низкий') : t('Обычный');
    if (field === 'RESPONSIBLE_ID' || field === 'CREATED_BY') return userName(value);
    if (field === 'ACCOMPLICES' || field === 'AUDITORS')
      return value.split(',').filter(Boolean).map(userName).join(', ');
    if (field === 'GROUP_ID')
      return projects.find((project) => project.id === value)?.name || `#${value}`;
    if (field === 'TIME_ESTIMATE' || field === 'TIME_SPENT_IN_LOGS')
      return String(secondsToHours(Number(value)));
    // Даты портал пишет в историю секундами Unix.
    if (/^\d{9,11}$/.test(value))
      return formatBitrixDateTime(new Date(Number(value) * 1000).toISOString());
    return value;
  };

  return (
    <Card padding="none" className="mt-6 overflow-hidden">
      <Button
        onClick={toggle}
        variant="quiet"
        size="sm"
        aria-expanded={open}
        className="h-auto w-full justify-start gap-2 bg-surface-2 px-4 py-2 text-sm font-bold"
        icon={<History size={14} strokeWidth={1.7} className="text-ink-faint" />}
        trailing={
          open ? (
            <ChevronUp size={14} strokeWidth={1.7} className="text-ink-faint" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.7} className="text-ink-faint" />
          )
        }
      >
        {t('История изменений')}
      </Button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-line p-3 sm:p-4">
          {failed ? (
            <p className="py-4 text-center text-sm text-ink-soft">
              {t('Не удалось загрузить историю.')}{' '}
              <Button size="sm" variant="text" onClick={load}>
                {t('Повторить')}
              </Button>
            </p>
          ) : !entries ? (
            <LoadingState className="min-h-24 bg-transparent" />
          ) : entries.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-soft">{t('Изменений пока нет')}</p>
          ) : (
            <ol className="space-y-2.5">
              {entries.map((entry) => (
                <li key={entry.id} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-whisper text-ink-faint">
                    <span className="font-bold text-ink-soft">{entry.userName}</span>
                    <time>{formatBitrixDateTime(entry.createdDate)}</time>
                  </div>
                  <p className="break-words text-ink">
                    <span className="text-ink-soft">{fieldLabel(entry.field)}</span>
                    {!WITHOUT_VALUE.has(entry.field) &&
                      (SAME_VALUE.has(entry.field) || entry.field.startsWith('CHECKLIST_') ? (
                        <>: {entry.to || entry.from}</>
                      ) : (
                        <>
                          :{' '}
                          <span className="text-ink-faint">{format(entry.field, entry.from)}</span>{' '}
                          → {format(entry.field, entry.to)}
                        </>
                      ))}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}
