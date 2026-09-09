import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Заставляем bitrix24.ts работать в «браузерном» режиме (in-memory cache),
// чтобы он не пытался динамически импортировать серверный mongo.ts и не
// ходил в настоящий MongoDB. isClient вычисляется один раз при загрузке
// модуля, поэтому настройку нужно выполнить ДО импорта bitrix24.
vi.hoisted(() => {
  // @ts-expect-error - vitest эмулирует window для cacheGet/cacheSet/memoryCache
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

describe('setSelectedProject: грузит стадии и не выбирает задачи проекта', () => {
  const events: string[] = [];
  const originalFetch = global.fetch;

  beforeEach(() => {
    events.length = 0;

    // Сброс стора между тестами, чтобы не было bleed-over между прогонами.
    useKanbanStore.setState({
      stages: [],
      tasks: [],
      subtasks: {},
      isLoading: false,
      isLoadingMore: false,
      isLoadingTask: false,
      selectedProjectId: null,
      selectedTaskId: null,
      hasMoreTasks: false,
      filters: {
        search: '',
        assigneeId: '',
        priority: '',
        status: '',
        hasDeadline: false,
        overdue: false,
        showCompleted: true,
      },
    } as any);

    global.fetch = vi.fn(async (url: any) => {
      const target = String(url || '');

      // Stages — медленнее, как часто и бывает в реальности (больше записей).
      if (target.includes('task.stages.get')) {
        events.push('stages:start');
        await new Promise((r) => setTimeout(r, 80));
        events.push('stages:end');
        return {
          ok: true,
          json: async () => ({
            result: {
              NEW: {
                ID: 'NEW',
                TITLE: 'New',
                SORT: '100',
                COLOR: '47d1e2',
                SYSTEM_TYPE: 'NEW',
              },
            },
          }),
        } as Response;
      }

      // Tasks — быстрее.
      if (target.includes('tasks.task.list')) {
        events.push('tasks:start');
        await new Promise((r) => setTimeout(r, 10));
        events.push('tasks:end');
        return {
          ok: true,
          json: async () => ({
            result: {
              tasks: [{ id: '1', title: 'T1', stageId: 'NEW', status: '2', priority: '1' }],
              total: 1,
              next: null,
            },
          }),
        } as Response;
      }

      return { ok: true, json: async () => ({ result: {} }) } as Response;
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('запрашивает стадии и не тянет задачи проекта: их грузят доска и список', async () => {
    await useKanbanStore.getState().setSelectedProject('group-1');
    await new Promise((r) => setTimeout(r, 200));

    // Стадии нужны доске сразу.
    expect(events.indexOf('stages:start')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('stages:end')).toBeGreaterThan(events.indexOf('stages:start'));

    // А вот вторая выборка тех же задач из Битрикса не нужна: и доска, и
    // список берут их постранично из зеркала, поэтому проект открывался
    // с двойной загрузкой.
    expect(events).not.toContain('tasks:start');
    expect(useKanbanStore.getState().isLoading).toBe(false);
  });
});
