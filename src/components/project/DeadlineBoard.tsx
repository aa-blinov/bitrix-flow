'use client';

import { useState, type ReactNode } from 'react';
import LoadingState from '@/components/LoadingState';
import { updateTaskFull } from '@/lib/bitrix24';
import {
  BUCKETS,
  bucketDeadline,
  deadlineBucket,
  type DeadlineBucket,
} from '@/lib/deadline-buckets';
import { dateFormat, t } from '@/lib/i18n';
import type { BxTask } from '@/types/bitrix';
import { useProjectTasks, useTaskModal } from './shared';

const DUE = dateFormat({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const BUCKET_LABELS: Record<DeadlineBucket, () => string> = {
  overdue: () => t('Просрочено'),
  today: () => t('Сегодня'),
  week: () => t('На этой неделе'),
  next: () => t('На следующей неделе'),
  later: () => t('Позже'),
  none: () => t('Без срока'),
};

/** Вид «Сроки»: открытые задачи по колонкам срока; перенос карточки ставит новый срок. */
export default function DeadlineBoard({
  projectId,
  toolbar,
}: {
  projectId: string;
  toolbar: ReactNode;
}) {
  const { tasks, setTasks, failed } = useProjectTasks(projectId);
  const { open, modal } = useTaskModal(tasks);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DeadlineBucket | null>(null);
  const [error, setError] = useState('');

  const move = async (taskId: string, bucket: DeadlineBucket) => {
    const deadline = bucketDeadline(bucket);
    const task = tasks?.find((item) => item.id === taskId);
    if (deadline === undefined || !task || deadlineBucket(task.dueDate) === bucket) return;
    const before = tasks;
    setTasks((list) =>
      (list || []).map((item) =>
        item.id === taskId ? { ...item, dueDate: deadline || undefined } : item,
      ),
    );
    setError('');
    try {
      await updateTaskFull(taskId, { deadline: deadline || '' });
    } catch (failure) {
      setTasks(before);
      setError(failure instanceof Error ? failure.message : t('Не удалось перенести срок'));
    }
  };

  const grouped = new Map<DeadlineBucket, BxTask[]>(BUCKETS.map((bucket) => [bucket, []]));
  for (const task of tasks || []) grouped.get(deadlineBucket(task.dueDate))!.push(task);

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 lg:px-6">{toolbar}</div>
      {error && (
        <p role="alert" className="px-4 pb-2 text-sm text-danger-text lg:px-6">
          {error}
        </p>
      )}
      {failed ? (
        <p role="alert" className="px-4 py-8 text-center text-danger-text lg:px-6">
          {t('Не удалось загрузить задачи проекта.')}
        </p>
      ) : !tasks ? (
        <LoadingState />
      ) : (
        <div className="flex gap-3 overflow-x-auto px-4 pb-4 lg:px-6">
          {BUCKETS.map((bucket) => {
            const list = grouped.get(bucket)!;
            const droppable = bucketDeadline(bucket) !== undefined;
            return (
              <section
                key={bucket}
                aria-label={BUCKET_LABELS[bucket]()}
                onDragOver={(event) => {
                  if (!droppable || !dragId) return;
                  event.preventDefault();
                  setOver(bucket);
                }}
                onDragLeave={() => setOver((current) => (current === bucket ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  if (dragId) void move(dragId, bucket);
                  setDragId(null);
                }}
                className={`flex w-64 shrink-0 flex-col rounded-ui border bg-surface p-2 ${
                  over === bucket ? 'border-accent' : 'border-line'
                }`}
              >
                <h2
                  className={`mb-2 flex items-center justify-between px-1 text-whisper font-bold tracking-widest uppercase ${
                    bucket === 'overdue' && list.length ? 'text-danger-text' : 'text-ink-faint'
                  }`}
                >
                  {BUCKET_LABELS[bucket]()}
                  <span className="text-ink-soft">{list.length}</span>
                </h2>
                <div className="flex min-h-16 flex-col gap-1.5">
                  {list.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => void open(task.id)}
                      className="rounded-ui border border-line bg-canvas px-2.5 py-2 text-left text-sm text-ink hover:border-line-strong"
                    >
                      <span className="line-clamp-2">{task.title}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-soft">
                        <span className="truncate">{task.assigneeName || t('Не назначен')}</span>
                        {task.dueDate && (
                          <span
                            className={`shrink-0 ${bucket === 'overdue' ? 'text-danger-text' : ''}`}
                          >
                            {DUE.format(new Date(task.dueDate))}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {modal}
    </div>
  );
}
