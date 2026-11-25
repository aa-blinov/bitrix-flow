'use client';

import { useCallback, useEffect, useState } from 'react';
import TaskModal from '@/components/TaskModal';
import { EMPTY_FILTERS } from '@/lib/task-filters';
import { fetchTaskGridPage } from '@/lib/task-grid-page';
import { useKanbanStore } from '@/store/kanban';
import type { BxTask } from '@/types/bitrix';

// Сервер отдаёт по 100 задач: пять страниц покрывают любой живой проект.
const MAX_PAGES = 5;

/** Открытые задачи проекта для видов «Сроки» и «Календарь»: из зеркала, как список. */
export function useProjectTasks(projectId: string) {
  const [tasks, setTasks] = useState<BxTask[] | null>(null);
  const [failed, setFailed] = useState(false);
  const tasksVersion = useKanbanStore((state) => state.tasksVersion);

  const load = useCallback(async () => {
    try {
      const all: BxTask[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const result = await fetchTaskGridPage(
          {
            page,
            limit: 100,
            query: '',
            sorts: [{ key: 'deadline', direction: 'asc' }],
            filters: { ...EMPTY_FILTERS, hideDone: 'on' },
            hierarchy: false,
            groupBy: 'none',
          },
          { projectId },
        );
        all.push(...result.tasks);
        if (all.length >= result.total || result.tasks.length === 0) break;
      }
      setTasks(all);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [projectId]);

  // tasksVersion растёт после правок в карточке: срок, поменянный там, сразу виден здесь.
  useEffect(() => {
    void load();
  }, [load, tasksVersion]);

  return { tasks, setTasks, failed, reload: load };
}

/** Карточка задачи поверх вида: задача кладётся в общий стор, чтобы карточка могла её править. */
export function useTaskModal(known?: BxTask[] | null) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useKanbanStore((state) =>
    taskId ? state.tasks.find((item) => item.id === taskId) : undefined,
  );
  const open = useCallback(
    async (id: string) => {
      // Задача вида уже есть: окно открывается сразу, права и детали догружает само.
      // Раньше ждали задачу из портала, и окно появлялось через 0,3–1 с после клика.
      const found = known?.find((item) => item.id === id);
      if (found) {
        const missing = (list: BxTask[]) =>
          list.some((item) => item.id === id) ? list : [...list, found];
        useKanbanStore.setState((state) => ({
          tasks: missing(state.tasks),
          allTasks: missing(state.allTasks),
        }));
      } else await useKanbanStore.getState().loadTaskById(id);
      setTaskId(id);
    },
    [known],
  );
  const modal = task ? (
    <TaskModal
      task={task}
      onClose={() => {
        setTaskId(null);
        useKanbanStore.getState().bumpTasksVersion();
      }}
    />
  ) : null;
  return { open, modal };
}
