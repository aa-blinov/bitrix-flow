// Серверный фоновый поллер задач.
//
// Запускается ровно один раз (через globalThis-синглтон, переживает hot-reload),
// опрашивает Bitrix24 раз в POLL_INTERVAL_MS по всем известным проектам и
// складывает обновления в MongoDB (`tasks` коллекция). После этого клиентские
// `tasksCacheGet` отдают свежие данные мгновенно.
//
// Ключевое требование: поллинг работает и тогда, когда ни один пользователь
// не открыл приложение — он живёт в фоне Next.js-сервера.

import { bx24OAuth } from './oauth-client';
import { getDb } from './mongo';

const POLL_INTERVAL_MS = 60_000; // 60 сек между полными проходами
const LOOKBACK_MS = 5 * 60_000; // первый запуск смотрит на 5 мин назад, чтобы поймать задачи, изменённые пока сервер лежал
const PAGE_SIZE = 50; // Bitrix24 tasks.task.list возвращает максимум 50 за раз

interface SyncState {
  intervalId: NodeJS.Timeout | null;
  lastSyncAt: Date;
  inFlight: boolean;
  subscribers: Set<(event: SyncEvent) => void>;
}

export type SyncEvent =
  | { type: 'task-updated'; memberId: string; projectId: string; count: number }
  | { type: 'sync-complete'; memberId: string; updatedTotal: number }
  | { type: 'sync-error'; memberId: string; error: string };

declare global {
  // eslint-disable-next-line no-var
  var __taskSync: SyncState | undefined;
}

function getState(): SyncState {
  if (!globalThis.__taskSync) {
    globalThis.__taskSync = {
      intervalId: null,
      lastSyncAt: new Date(Date.now() - LOOKBACK_MS),
      inFlight: false,
      subscribers: new Set(),
    };
  }
  return globalThis.__taskSync;
}

export function startBackgroundSync(): void {
  const state = getState();
  if (state.intervalId) return; // идемпотентно — singleton уже идёт

  // Не конкурируем с первым открытием приложения после рестарта: Bitrix24
  // ограничивает параллельные REST-вызовы, а немедленный полный обход проектов
  // задерживал загрузку первой доски. Первый sync начнётся через минуту.
  state.intervalId = setInterval(() => {
    void syncOnce().catch((e) => console.error('[task-sync] iteration failed', e));
  }, POLL_INTERVAL_MS);
}

export function getLastSyncAt(): Date {
  return getState().lastSyncAt;
}

export function subscribeSync(listener: (event: SyncEvent) => void): () => void {
  const state = getState();
  state.subscribers.add(listener);
  return () => {
    state.subscribers.delete(listener);
  };
}

function notify(event: SyncEvent): void {
  getState().subscribers.forEach((l) => {
    try {
      l(event);
    } catch (e) {
      console.error('[task-sync] subscriber error', e);
    }
  });
}

async function syncOnce(): Promise<void> {
  const state = getState();
  if (state.inFlight) return; // не запускаем параллельные проходы
  state.inFlight = true;
  try {
    const db = await getDb();
    // Берём все активные OAuth-токены портала
    const tokens = await db
      .collection('user_tokens')
      .find({ access_token: { $exists: true } })
      .toArray();

    for (const token of tokens) {
      try {
        await syncMember(token.member_id as string);
      } catch (e) {
        console.error('[task-sync] member failed', token.member_id, e);
        notify({
          type: 'sync-error',
          memberId: String(token.member_id),
          error: String(e),
        });
      }
    }
    state.lastSyncAt = new Date();
  } finally {
    state.inFlight = false;
  }
}

async function syncMember(memberId: string): Promise<void> {
  const db = await getDb();
  // Список проектов берём из локальной БД — он туда попадает при /api/dashboard
  const projects = await db.collection('projects').find({}).toArray();
  let memberTotal = 0;

  for (const project of projects) {
    const updated = await fetchChanged(memberId, project.id as string);
    if (updated.length === 0) continue;

    await upsertTasks(memberId, project.id as string, updated);
    memberTotal += updated.length;
    notify({
      type: 'task-updated',
      memberId,
      projectId: project.id as string,
      count: updated.length,
    });

    // Пуш в events_stream — существующий /api/events SSE подхватит
    // и раздаст подключённым клиентам (через src/hooks/useSSE.ts).
    if (updated.length > 0) {
      await db.collection('events_stream').insertOne({
        member_id: memberId,
        event: {
          type: 'tasks-changed',
          projectId: project.id,
          count: updated.length,
          at: new Date().toISOString(),
        },
        created_at: new Date(),
      });
    }
  }

  if (memberTotal > 0) {
    notify({ type: 'sync-complete', memberId, updatedTotal: memberTotal });
  }
}

async function fetchChanged(memberId: string, projectId: string): Promise<any[]> {
  // Bitrix24 tasks.task.list с фильтром >=CHANGED_DATE возвращает только
  // изменённые после указанной даты. Идём постранично.
  const since = getState().lastSyncAt;
  const allTasks: any[] = [];
  let start = 0;
  // На всякий случай — защита от бесконечного цикла (макс 1000 задач за проход)
  for (let page = 0; page < 20; page += 1) {
    const data = await bx24OAuth(memberId, 'tasks.task.list', {
      'filter[GROUP_ID]': projectId,
      'filter[>=CHANGED_DATE]': since.toISOString(),
      start: String(start),
    });
    const batch = data?.result?.tasks || data?.tasks || [];
    if (!Array.isArray(batch) || batch.length === 0) break;
    allTasks.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return allTasks;
}

async function upsertTasks(memberId: string, projectId: string, tasks: any[]): Promise<void> {
  const db = await getDb();
  const ops = tasks.map((t) => {
    const id = String(t.id ?? t.ID);
    return {
      updateOne: {
        filter: { groupId: projectId, id },
        update: {
          $set: {
            groupId: projectId,
            id,
            member_id: memberId,
            data: t,
            updated_at: new Date(),
          },
        },
        upsert: true,
      },
    };
  });
  if (ops.length > 0) {
    await db.collection('tasks').bulkWrite(ops, { ordered: false });
  }
}
