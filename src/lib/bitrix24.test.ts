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

import { attachFileToTask, createTask, fetchSubtasks, fetchTaskComments } from './bitrix24';

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

describe('прикрепление файла к задаче', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('отправляет задачу, проект и сам файл в /api/task-file/upload', async () => {
    let body: FormData | null = null;
    global.fetch = vi.fn(async (url: any, init: any) => {
      body = init.body as FormData;
      return {
        ok: true,
        json: async () => ({ id: '20453', name: 'probe.txt', size: 12 }),
      } as Response;
    }) as any;

    const file = new File(['probe'], 'probe.txt', { type: 'text/plain' });
    const result = await attachFileToTask('5477', file);

    expect(result).toEqual({ id: '20453', name: 'probe.txt', size: 12 });
    expect(body).not.toBeNull();
    expect((body as unknown as FormData).get('taskId')).toBe('5477');
    expect((body as unknown as FormData).get('file')).toBe(file);
  });
});

describe('комментарии задачи', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockSources = (legacy: any[], messages: any[]) => {
    global.fetch = vi.fn(async (url: any) => {
      const target = String(url || '');
      if (target.includes('task.commentitem.getlist')) {
        return { ok: true, json: async () => ({ result: legacy }) } as Response;
      }
      if (target.includes('im.dialog.messages.get')) {
        return { ok: true, json: async () => ({ result: { messages } }) } as Response;
      }
      return { ok: true, json: async () => ({ result: {} }) } as Response;
    }) as any;
  };

  it('берёт старые комментарии из task.commentitem и новые — из чата', async () => {
    mockSources(
      [
        {
          ID: '10',
          AUTHOR_ID: '9',
          AUTHOR_NAME: 'Александр',
          POST_DATE: '2025-07-29T12:24:03+03:00',
          POST_MESSAGE: 'Старый комментарий',
        },
      ],
      [
        {
          id: '55',
          author_id: '9',
          author_name: 'Александр',
          date: '2026-03-19T10:00:00+03:00',
          text: 'Новый комментарий',
        },
      ],
    );

    const comments = await fetchTaskComments('77', '777');
    expect(comments.map((c) => c.text)).toEqual(['Старый комментарий', 'Новый комментарий']);
    expect(comments[0]?.id).toBe('legacy-10');
    expect(comments[1]?.id).toBe('chat-55');
  });

  it('служебные сообщения чата не считаются комментариями', async () => {
    mockSources(
      [],
      [
        {
          id: '56',
          // Именно число 0, а не строка:служебные сообщения приходят с author_id = 0.
          author_id: 0,
          author_name: '',
          date: '2026-03-19T10:00:00+03:00',
          text: 'Это новый чат задачи',
        },
        {
          id: '58',
          author_id: '0',
          author_name: '',
          date: '2026-03-19T10:02:00+03:00',
          text: 'Строковый ноль тоже не комментарий',
        },
        {
          id: '57',
          author_id: '9',
          author_name: 'Александр',
          date: '2026-03-19T10:05:00+03:00',
          text: 'Живой комментарий',
        },
      ],
    );

    const comments = await fetchTaskComments('78', '777');
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe('Живой комментарий');
  });

  it('один и тот же комментарий из обоих источников не дублируется', async () => {
    mockSources(
      [
        {
          ID: '20',
          AUTHOR_ID: '9',
          AUTHOR_NAME: 'Александр',
          POST_DATE: '2026-03-19T10:00:00+03:00',
          POST_MESSAGE: 'Один раз',
        },
      ],
      [
        {
          id: '60',
          author_id: '9',
          author_name: 'Александр',
          date: '2026-03-19T10:00:00+03:00',
          text: 'Один раз',
        },
      ],
    );

    const comments = await fetchTaskComments('79', '777');
    expect(comments).toHaveLength(1);
  });
});
