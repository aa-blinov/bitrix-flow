'use client';

import { useCallback, useEffect, useState } from 'react';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { useTaskModal } from '@/components/project/shared';
import { dateFormat, t } from '@/lib/i18n';
import type { PlanStage } from '@/app/api/my-plan/route';

const DUE = dateFormat({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Пишется только в эффекте, поэтому на сервере остаётся пустым и не делится между людьми.
let lastPlan: PlanStage[] | null = null;

/** «Мой план» портала: личный канбан со своими колонками, у каждого свой. */
export default function MyPlanPage() {
  const [stages, setStages] = useState<PlanStage[] | null>(() => lastPlan);
  // План с прошлого захода виден сразу, свежий из портала (полсекунды) приходит следом.
  useEffect(() => {
    if (stages) lastPlan = stages;
  }, [stages]);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { open, modal } = useTaskModal();
  // Граница просрочки на момент открытия: Date.now() в рендере нечист.
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/my-plan');
      if (!response.ok) throw new Error();
      setStages((await response.json()).stages || []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const move = async (taskId: string, stageId: string) => {
    const from = stages?.find((stage) => stage.tasks.some((task) => task.id === taskId));
    if (!stages || !from || from.id === stageId) return;
    const task = from.tasks.find((item) => item.id === taskId)!;
    const before = stages;
    setStages(
      stages.map((stage) =>
        stage.id === from.id
          ? { ...stage, tasks: stage.tasks.filter((item) => item.id !== taskId) }
          : stage.id === stageId
            ? { ...stage, tasks: [task, ...stage.tasks] }
            : stage,
      ),
    );
    setError('');
    const response = await fetch('/api/my-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, stageId }),
    }).catch(() => null);
    if (!response?.ok) {
      setStages(before);
      setError(t('Не удалось перенести задачу в плане'));
    }
  };

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader
        title={t('Мой план')}
        description={t('Личные колонки из Битрикс24: как вы сами планируете свои задачи')}
      />
      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger-text lg:px-6">
          {error}
        </p>
      )}
      {failed ? (
        <p role="alert" className="px-4 py-8 text-center text-danger-text lg:px-6">
          {t('Не удалось загрузить план.')}
        </p>
      ) : !stages ? (
        <LoadingState />
      ) : (
        <div className="mt-4 flex items-start gap-3 overflow-x-auto px-4 pb-4 lg:px-6">
          {stages.map((stage) => (
            <section
              key={stage.id}
              aria-label={stage.title}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                if (dragId) void move(dragId, stage.id);
                setDragId(null);
              }}
              // Колонка прокручивается сама: сотня нераспланированных тянула страницу на шесть экранов.
              className={`flex max-h-[calc(100dvh-8rem)] w-72 shrink-0 flex-col rounded-ui border bg-surface p-2 ${
                over === stage.id ? 'border-accent' : 'border-line'
              }`}
            >
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-bold text-ink">
                {stage.title}
                <span className="text-xs font-normal text-ink-soft">{stage.tasks.length}</span>
              </h2>
              <div className="-mr-1 flex min-h-16 flex-col gap-1.5 overflow-y-auto pr-1">
                {stage.tasks.map((task) => (
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
                    {task.deadline && (
                      <span
                        className={`mt-1 block text-xs ${
                          new Date(task.deadline).getTime() < now
                            ? 'text-danger-text'
                            : 'text-ink-soft'
                        }`}
                      >
                        {DUE.format(new Date(task.deadline))}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {modal}
    </div>
  );
}
