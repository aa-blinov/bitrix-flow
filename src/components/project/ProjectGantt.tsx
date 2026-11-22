'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import LoadingState from '@/components/LoadingState';
import { Button } from '@/components/monos/Button';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { ganttSpan, type GanttLink } from '@/lib/gantt';
import { dateFormat, t } from '@/lib/i18n';
import { useProjectTasks, useTaskModal } from './shared';

const DAY = 86_400_000;
const DAY_WIDTH = 28;
const ROW = 40;
// Задачи, созданные год назад, растянули бы шкалу на метры: показываем до восьми месяцев.
const MAX_DAYS = 240;
const MONTH = dateFormat({ month: 'long', year: 'numeric' });

const startOfDay = (time: number) => {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** Вид «Гант»: полосы задач по датам и связи «финиш → старт» из портала. */
export default function ProjectGantt({
  projectId,
  toolbar,
}: {
  projectId: string;
  toolbar: ReactNode;
}) {
  const { tasks, failed } = useProjectTasks(projectId);
  const { open, modal } = useTaskModal();
  const confirm = useConfirm();
  const [links, setLinks] = useState<GanttLink[]>([]);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());

  const rows = useMemo(
    () =>
      (tasks || [])
        .map((task) => ({ task, span: ganttSpan(task) }))
        .filter(
          (row): row is { task: (typeof row)['task']; span: NonNullable<(typeof row)['span']> } =>
            Boolean(row.span),
        )
        .sort((a, b) => a.span.start - b.span.start),
    [tasks],
  );

  const idsKey = rows.map((row) => row.task.id).join(',');
  const loadLinks = useCallback(async () => {
    if (!idsKey) return;
    try {
      const response = await fetch(`/api/projects/gantt?ids=${idsKey}`);
      if (!response.ok) throw new Error();
      setLinks((await response.json()).links || []);
    } catch {
      setError(t('Не удалось загрузить связи задач.'));
    }
  }, [idsKey]);
  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const range = useMemo(() => {
    if (!rows.length) return null;
    const last = Math.max(...rows.map((row) => row.span.end));
    // Сегодня попадает на шкалу, только если недалеко от задач: иначе старый проект
    // уезжал бы в левый край, а справа тянулись бы пустые месяцы.
    const end = startOfDay(now > last && now - last < 60 * DAY ? now : last) + 3 * DAY;
    const first = startOfDay(Math.min(...rows.map((row) => row.span.start))) - 2 * DAY;
    const start = Math.max(first, end - MAX_DAYS * DAY);
    return { start, days: Math.round((end - start) / DAY) };
  }, [rows, now]);

  const changeLink = async (method: 'POST' | 'DELETE', from: string, to: string) => {
    setError('');
    const response = await fetch('/api/projects/gantt', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.message || t('Не удалось изменить связь'));
      return;
    }
    await loadLinks();
  };

  const pick = (taskId: string) => {
    if (!linkFrom) return void open(taskId);
    const from = linkFrom;
    setLinkFrom(null);
    if (from === taskId || links.some((link) => link.from === from && link.to === taskId)) return;
    void changeLink('POST', from, taskId);
  };

  const removeLink = async (link: GanttLink) => {
    const title = (id: string) => rows.find((row) => row.task.id === id)?.task.title || `#${id}`;
    const agreed = await confirm({
      title: t('Удалить связь?'),
      description: t('«{0}» больше не будет ждать «{1}».', title(link.to), title(link.from)),
      confirmLabel: t('Удалить'),
      destructive: true,
    });
    if (agreed) await changeLink('DELETE', link.from, link.to);
  };

  const x = (time: number) => ((time - (range?.start || 0)) / DAY) * DAY_WIDTH;

  // Шкала начинается со старейшей задачи: в живом проекте это месяцы назад, и вид открывался
  // на пустом июле. Прокручиваем к сегодняшнему дню, если он на шкале.
  const scroller = useRef<HTMLDivElement>(null);
  const rangeStart = range?.start;
  useEffect(() => {
    const element = scroller.current;
    if (!element || rangeStart === undefined) return;
    const today = ((now - rangeStart) / DAY) * DAY_WIDTH;
    element.scrollLeft = Math.max(0, today - element.clientWidth / 2);
  }, [rangeStart, now]);
  const rowIndex = new Map(rows.map((row, index) => [row.task.id, index]));
  const days = range ? Array.from({ length: range.days }, (_, i) => range.start + i * DAY) : [];
  const width = days.length * DAY_WIDTH;
  const fromTitle = rows.find((row) => row.task.id === linkFrom)?.task.title;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">{toolbar}</div>
      {linkFrom && (
        <div
          role="status"
          className="mx-4 mb-2 flex items-center gap-3 rounded-ui border border-accent bg-surface px-3 py-2 text-sm lg:mx-6"
        >
          <span className="min-w-0 flex-1">
            {t('Выберите задачу, которая начнётся после «{0}»', fromTitle || '')}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setLinkFrom(null)}>
            {t('Отмена')}
          </Button>
        </div>
      )}
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
      ) : !range ? (
        <p className="px-4 py-8 text-center text-sm text-ink-soft lg:px-6">
          {t('У открытых задач проекта нет дат, Ганту нечего показать.')}
        </p>
      ) : (
        <div className="mx-4 mb-6 flex overflow-hidden rounded-ui border border-line lg:mx-6">
          <div className="w-56 shrink-0 border-r border-line bg-surface max-sm:w-36">
            <div className="h-12 border-b border-line" />
            {rows.map(({ task }) => (
              <button
                key={task.id}
                type="button"
                onClick={() => void open(task.id)}
                style={{ height: ROW }}
                className="block w-full truncate border-b border-line px-3 text-left text-sm text-ink hover:bg-surface-2"
              >
                {task.title}
              </button>
            ))}
          </div>
          <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
            <div className="relative" style={{ width }}>
              <div className="flex h-12 flex-col border-b border-line">
                <div className="relative h-6">
                  {days
                    // Подпись первого неполного месяца не наезжает на следующую.
                    .filter((day, i) =>
                      i === 0 ? new Date(day).getDate() <= 24 : new Date(day).getDate() === 1,
                    )
                    .map((day) => (
                      <span
                        key={day}
                        style={{ left: x(day) + 4 }}
                        className="absolute top-1 text-xs whitespace-nowrap text-ink-soft first-letter:uppercase"
                      >
                        {MONTH.format(day)}
                      </span>
                    ))}
                </div>
                <div className="flex h-6">
                  {days.map((day) => (
                    <span
                      key={day}
                      style={{ width: DAY_WIDTH }}
                      className="shrink-0 text-center text-[10px] leading-6 text-ink-faint"
                    >
                      {new Date(day).getDate()}
                    </span>
                  ))}
                </div>
              </div>
              <div className="relative" style={{ height: rows.length * ROW }}>
                {/* Выходные чуть темнее: по ним видно недели. */}
                {days.map((day) =>
                  [0, 6].includes(new Date(day).getDay()) ? (
                    <div
                      key={day}
                      style={{ left: x(day), width: DAY_WIDTH }}
                      className="absolute inset-y-0 bg-surface"
                    />
                  ) : null,
                )}
                <div
                  aria-hidden="true"
                  style={{ left: x(now) }}
                  className="absolute inset-y-0 w-px bg-accent"
                />
                {rows.map(({ task, span }, index) => {
                  const left = Math.max(0, x(span.start));
                  const right = Math.max(left + 8, x(span.end));
                  const overdue = Boolean(task.dueDate) && new Date(task.dueDate!).getTime() < now;
                  return (
                    <div
                      key={task.id}
                      style={{ top: index * ROW + 8, left, width: right - left }}
                      className="group absolute h-6"
                    >
                      <button
                        type="button"
                        onClick={() => pick(task.id)}
                        aria-label={
                          linkFrom
                            ? t('Начать после выбранной: {0}', task.title)
                            : t('Открыть задачу {0}', task.title)
                        }
                        className={`size-full truncate rounded-ui px-2 text-left text-xs ${
                          overdue
                            ? 'bg-danger/20 text-danger-text'
                            : span.planned
                              ? 'bg-accent/30 text-ink'
                              : 'border border-dashed border-line-strong bg-surface-2 text-ink'
                        } ${linkFrom && linkFrom !== task.id ? 'ring-1 ring-accent' : ''}`}
                      >
                        {right - left > 80 ? task.title : ''}
                      </button>
                      {!linkFrom && (
                        <button
                          type="button"
                          aria-label={t('Связать: после «{0}»', task.title)}
                          title={t('Связать с задачей, которая начнётся после этой')}
                          onClick={() => setLinkFrom(task.id)}
                          className="absolute top-1/2 -right-2 size-3 -translate-y-1/2 rounded-full border border-line-strong bg-canvas opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                        />
                      )}
                    </div>
                  );
                })}
                <svg
                  className="pointer-events-none absolute inset-0"
                  width={width}
                  height={rows.length * ROW}
                >
                  <defs>
                    <marker
                      id="gantt-arrow"
                      markerWidth="6"
                      markerHeight="6"
                      refX="5"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0,0 L6,3 L0,6 z" className="fill-ink-soft" />
                    </marker>
                  </defs>
                  {links.map((link) => {
                    const fromIndex = rowIndex.get(link.from);
                    const toIndex = rowIndex.get(link.to);
                    if (fromIndex === undefined || toIndex === undefined) return null;
                    const fromRow = rows[fromIndex];
                    const toRow = rows[toIndex];
                    const x1 = x(fromRow.span.end);
                    const y1 = fromIndex * ROW + ROW / 2;
                    const x2 = Math.max(0, x(toRow.span.start));
                    const y2 = toIndex * ROW + ROW / 2;
                    const bend = Math.max(x1 + 8, x2 - 8);
                    const d = `M${x1},${y1} H${bend} V${y2} H${x2}`;
                    return (
                      <g key={`${link.from}-${link.to}`}>
                        <path
                          d={d}
                          fill="none"
                          className="stroke-ink-soft"
                          strokeWidth={1.2}
                          markerEnd="url(#gantt-arrow)"
                        />
                        {/* Широкая прозрачная линия поверх: по тонкой стрелке не попасть. */}
                        <path
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={10}
                          className="pointer-events-auto cursor-pointer"
                          role="button"
                          aria-label={t('Связь: {0} → {1}', fromRow.task.title, toRow.task.title)}
                          onClick={() => void removeLink(link)}
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
      {modal}
    </div>
  );
}
