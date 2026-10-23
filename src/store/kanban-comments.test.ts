import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// bitrix24.ts работает в «браузерном» режиме (in-memory cache), чтобы не
// тянуть серверный mongo.ts. isClient вычисляется один раз при загрузке
// модуля, поэтому window нужно выставить ДО импорта стора.
vi.hoisted(() => {
  // @ts-expect-error - vitest эмулирует window для cacheGet/cacheSet
  globalThis.window = { location: { search: '' } };
  const mem: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => {
      mem[k] = v;
    },
    removeItem: (k: string) => {
      delete mem[k];
    },
    clear: () => {
      for (const k of Object.keys(mem)) delete mem[k];
    },
    key: (i: number) => Object.keys(mem)[i] ?? null,
    get length() {
      return Object.keys(mem).length;
    },
  } as any;
});

import { useKanbanStore } from './kanban';

const taskWithDetails = (id: string) =>
  ({
    id,
    projectId: '1',
    title: 'Задача',
    comments: [{ id: 'c1', taskId: id, text: 'Комментарий', authorId: '9', authorName: 'A' }],
    checklist: [{ id: 'i1', title: 'Пункт', completed: false }],
    timeEntries: [{ id: 'e1', taskId: id, seconds: 3600 }],
    subtasks: [{ id: 'sub1', title: 'Подзадача' }],
    results: [{ id: 'r1', text: 'Результат' }],
  }) as any;

describe('перезагрузка списка задач не стирает детали открытой карточки', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useKanbanStore.setState({
      tasks: [taskWithDetails('1')],
      allTasks: [],
      selectedProjectId: '1',
      selectedTaskId: '1',
    } as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('сохраняет комментарии, чек-лист, время и подзадачи', async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('tasks.task.list')) {
        return {
          ok: true,
          json: async () => ({
            result: { tasks: [{ id: '1', title: 'Переименованная задача' }], total: 1 },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ result: {} }) } as Response;
    }) as any;

    await useKanbanStore.getState().loadTasks('1');

    const task = useKanbanStore.getState().tasks[0];
    expect(task.title).toBe('Переименованная задача');
    expect(task.comments).toHaveLength(1);
    expect(task.checklist).toHaveLength(1);
    expect(task.timeEntries).toHaveLength(1);
    expect(task.subtasks).toHaveLength(1);
    expect(task.results).toHaveLength(1);
  });

  it('не переносит детали одной задачи на другую', async () => {
    useKanbanStore.setState({ tasks: [taskWithDetails('2')], allTasks: [] } as any);
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('tasks.task.list')) {
        return {
          ok: true,
          json: async () => ({
            result: { tasks: [{ id: '1', title: 'Другая задача' }], total: 1 },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ result: {} }) } as Response;
    }) as any;

    await useKanbanStore.getState().loadTasks('1');

    const task = useKanbanStore.getState().tasks[0];
    expect(task.id).toBe('1');
    expect(task.comments).toHaveLength(0);
    expect(task.checklist).toHaveLength(0);
  });
});
