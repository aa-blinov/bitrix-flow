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
const FIRST_RUN_DELAY_MS = 15_000; // первый проход после старта сервера
const RECONCILE_EVERY_MS = 60 * 60_000; // полная сверка состава раз в час
const OVERLAP_MS = 2 * 60_000; // перехлёст окна, чтобы не терять правки на границе прохода
const LOOKBACK_MS = 5 * 60_000; // первый запуск смотрит на 5 мин назад, чтобы поймать задачи, изменённые пока сервер лежал
const PAGE_SIZE = 50; // Bitrix24 tasks.task.list возвращает максимум 50 за раз

interface SyncState {
  intervalId: NodeJS.Timeout | null;
  lastSyncAt: Date;
  lastReconcileAt: number;
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
      lastReconcileAt: 0,
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
  // ограничивает параллельные REST-вызовы. Но и ждать целую минуту незачем —
  // после рестарта состояние тем более устарело, поэтому первый проход через
  // FIRST_RUN_DELAY_MS, дальше по интервалу.
  setTimeout(() => {
    void syncOnce().catch((e) => console.error('[task-sync] iteration failed', e));
  }, FIRST_RUN_DELAY_MS);
  state.intervalId = setInterval(() => {
    void syncOnce().catch((e) => console.error('[task-sync] iteration failed', e));
  }, POLL_INTERVAL_MS);
  console.log(`[task-sync] поллер запущен, интервал ${POLL_INTERVAL_MS / 1000}с`);
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
  // Окно отсчитываем от начала прохода и с перехлёстом: раньше отметка
  // ставилась по завершении, поэтому всё, что изменилось во время прохода,
  // не попадало ни в этот круг, ни в следующий.
  const startedAt = new Date();
  const since = new Date(state.lastSyncAt.getTime() - OVERLAP_MS);
  try {
    const db = await getDb();
    // Берём все активные OAuth-токены портала
    const tokens = await db
      .collection('user_tokens')
      .find({ access_token: { $exists: true } })
      .toArray();

    for (const token of tokens) {
      try {
        await syncMember(token.member_id as string, since);
        if (Date.now() - state.lastReconcileAt > RECONCILE_EVERY_MS) {
          await reconcileDeleted(token.member_id as string);
          state.lastReconcileAt = Date.now();
        }
      } catch (e) {
        console.error('[task-sync] member failed', token.member_id, e);
        notify({
          type: 'sync-error',
          memberId: String(token.member_id),
          error: String(e),
        });
      }
    }
    state.lastSyncAt = startedAt;
  } finally {
    state.inFlight = false;
  }
}

async function syncMember(memberId: string, since: Date): Promise<void> {
  const db = await getDb();
  // Раньше проход шёл по списку проектов из локальной БД: 51 запрос за круг,
  // любая сетевая ошибка на первом же проекте обрывала весь круг (а этот
  // портал регулярно не отвечает с части адресов), и задачи вне проектов
  // не синхронизировались вовсе. Один запрос по CHANGED_DATE закрывает всё:
  // и все проекты сразу, и задачи без группы.
  let updated: any[] = [];
  try {
    updated = await fetchChanged(memberId, since);
  } catch (e) {
    console.error('[task-sync] fetch failed', memberId, e);
    notify({ type: 'sync-error', memberId, error: String(e) });
    return;
  }
  if (updated.length === 0) return;

  await upsertTasks(memberId, updated);
  console.log(`[task-sync] обновлено задач: ${updated.length} (с ${since.toISOString()})`);

  // Клиентам сообщаем по проектам: доска слушает свой projectId.
  const byProject = new Map<string, number>();
  for (const task of updated) {
    const projectId = String(task.groupId ?? task.group?.id ?? task.GROUP_ID ?? '0');
    byProject.set(projectId, (byProject.get(projectId) || 0) + 1);
  }
  for (const [projectId, count] of byProject) {
    notify({ type: 'task-updated', memberId, projectId, count });
    // Пуш в events_stream — существующий /api/events SSE подхватит
    // и раздаст подключённым клиентам (через src/hooks/useSSE.ts).
    await db.collection('events_stream').insertOne({
      member_id: memberId,
      event: {
        type: 'tasks-changed',
        projectId,
        count,
        at: new Date().toISOString(),
      },
      created_at: new Date(),
    });
  }

  notify({ type: 'sync-complete', memberId, updatedTotal: updated.length });
}

async function fetchChanged(memberId: string, since: Date): Promise<any[]> {
  // Bitrix24 tasks.task.list с фильтром >=CHANGED_DATE возвращает только
  // изменённые после указанной даты. Идём постранично.
  const allTasks: any[] = [];
  let start = 0;
  // На всякий случай — защита от бесконечного цикла (макс 1000 задач за проход)
  for (let page = 0; page < 20; page += 1) {
    const data = await bx24OAuth(memberId, 'tasks.task.list', {
      'filter[>=CHANGED_DATE]': since.toISOString(),
      // '*' сохраняет весь набор полей по умолчанию, TAGS добавляет штатные
      // теги задачи — без него зеркало о них не знает.
      'select[0]': '*',
      'select[1]': 'TAGS',
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

// Изменения ловятся по CHANGED_DATE, а удаление даты не меняет: задача просто
// исчезает из Битрикса. Вебхук ONTASKDELETE её убирает, но если он потерялся
// (или задачу удалили, пока сервер лежал), запись остаётся навсегда — на
// проверке 300 задач зеркала таких призраков нашлось 52. Раз в час сверяем
// состав и подчищаем.
async function reconcileDeleted(memberId: string): Promise<void> {
  const db = await getDb();
  const alive = new Set<string>();
  let start = 0;
  for (let page = 0; page < 200; page += 1) {
    let data: any;
    try {
      data = await bx24OAuth(memberId, 'tasks.task.list', {
        'select[0]': 'ID',
        start: String(start),
      });
    } catch (e) {
      // Неполный список — не повод удалять: пропускаем сверку до следующего раза.
      console.error('[task-sync] reconcile aborted', memberId, e);
      return;
    }
    const batch = data?.result?.tasks || data?.tasks || [];
    if (!Array.isArray(batch) || batch.length === 0) break;
    batch.forEach((t: any) => alive.add(String(t.id ?? t.ID)));
    if (batch.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  if (alive.size === 0) return;

  const localIds = await db.collection('task_mirror').distinct('id', { member_id: memberId });
  const stale = localIds.filter((id: string) => !alive.has(String(id)));
  if (stale.length === 0) return;

  await Promise.all([
    db.collection('task_mirror').deleteMany({ member_id: memberId, id: { $in: stale } }),
    db.collection('tasks').deleteMany({ id: { $in: stale } }),
  ]);
  console.log(`[task-sync] удалено задач, которых больше нет в Битриксе: ${stale.length}`);
}

async function upsertTasks(memberId: string, tasks: any[]): Promise<void> {
  const db = await getDb();
  const ops = tasks.map((t) => {
    const id = String(t.id ?? t.ID);
    const projectId = String(t.groupId ?? t.group?.id ?? t.GROUP_ID ?? '0');
    return {
      updateOne: {
        // Ключ только по id: при переносе задачи в другой проект фильтр по
        // groupId плодил вторую запись, а старая оставалась висеть.
        filter: { id },
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
