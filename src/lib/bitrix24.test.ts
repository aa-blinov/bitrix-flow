import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// bitrix24.ts работает в «браузерном» режиме (in-memory cache), чтобы не
// тянуть серверный mongo.ts. isClient вычисляется один раз при загрузке
// модуля, поэтому window нужно выставить ДО импорта.
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

import { createTask, fetchSubtasks } from './bitrix24';

describe('кэш списка подзадач', () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    global.fetch = vi.fn(async (url: any, init: any) => {
      const body = String(init?.body || '');
      const target = String(url || '');
      calls.push(`${target} ${body}`);
      if (target.includes('tasks.task.list')) {
        return { ok: true, json: async () => ({ result: { tasks: [] } }) } as Response;
      }
      if (target.includes('tasks.task.add')) {
        return { ok: true, json: async () => ({ result: { task: { id: '99' } } }) } as Response;
      }
      return { ok: true, json: async () => ({ result: {} }) } as Response;
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('не скрывает новую подзадачу: кэш родителя сбрасывается после создания', async () => {
    // Первый запрос кладёт в кэш пустой список подзадач.
    await fetchSubtasks('42');
    await createTask({ title: 'Подзадача', parentId: '42', groupId: 1, responsibleId: 9 });
    // После создания подзадачи список должен быть запрошен заново.
    await fetchSubtasks('42');

    const listCalls = calls.filter(
      (call) => call.includes('tasks.task.list') && call.includes('PARENT_ID'),
    );
    expect(listCalls).toHaveLength(2);
  });

  it('не трогает кэш подзадач, если создана обычная задача', async () => {
    await fetchSubtasks('43');
    await createTask({ title: 'Обычная', groupId: 1, responsibleId: 9 });
    await fetchSubtasks('43');

    const listCalls = calls.filter(
      (call) => call.includes('tasks.task.list') && call.includes('PARENT_ID'),
    );
    expect(listCalls).toHaveLength(1);
  });
});
