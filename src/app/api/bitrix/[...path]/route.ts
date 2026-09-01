import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { serverCache, invalidateByPrefix } from '@/lib/server-cache';
import { postBitrixJson } from '@/lib/bitrix-request';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { isMockEnabled, mockHandle } from '@/lib/mock-b24';

// ponytail: чтение/запись MongoDB-кэша задач прямо из прокси-роута.
// Клиентский fetchTasksByProject (в src/lib/bitrix24.ts) тоже ходит в tasksCacheGet,
// но в браузере это пустая трата — пусть proxy отдаёт кэш из MongoDB напрямую.
async function mongoTasksCacheRead(
  method: string,
  params: Record<string, string>,
): Promise<any | null> {
  if (method !== 'tasks.task.list') return null;
  // "Активные задачи" или любые другие фильтры — скип, кэш только полный список.
  if (params['filter[!STATUS]']) return null;

  const groupId = params['filter[GROUP_ID]'] || params['filter%5BGROUP_ID%5D'];
  if (!groupId) return null;

  const since = params['filter[>=CHANGED_DATE]'] || params['filter%5B%3E%3DCHANGED_DATE%5D'];

  try {
    const db = await getDb();
    if (since) {
      const docs = await db.collection('tasks').find({ groupId }).toArray();
      if (docs.length === 0) return null;
      const sinceDate = new Date(since);
      const tasks = docs
        .map((d) => d.data)
        .filter((t: any) => {
          const changed = t.changedDate || t.CHANGED_DATE;
          return changed && new Date(changed) >= sinceDate;
        });
      return { tasks, next: undefined, total: tasks.length };
    }
    const docs = await db.collection('tasks').find({ groupId }).toArray();
    if (docs.length === 0) return null;
    return {
      tasks: docs.map((d) => d.data),
      next: undefined,
      total: docs.length,
    };
  } catch {
    return null;
  }
}

async function mongoTasksCacheWrite(
  method: string,
  params: Record<string, string>,
  data: any,
): Promise<void> {
  if (method !== 'tasks.task.list') return;
  // Если стоит filter[!STATUS]=5 — это запрос "только активные", его
  // кэшировать нельзя (любая мутация может перевести задачу в done).
  if (params['filter[!STATUS]']) return;

  const groupId = params['filter[GROUP_ID]'] || params['filter%5BGROUP_ID%5D'];
  if (!groupId) return; // без проекта — неклассифицированные задачи, скип

  const tasks = data?.tasks || (Array.isArray(data) ? data : []);
  if (!Array.isArray(tasks) || tasks.length === 0) return;

  try {
    const db = await getDb();
    const ops = tasks.map((t: any) => {
      const id = String(t.id ?? t.ID);
      return {
        updateOne: {
          filter: { groupId, id },
          update: {
            $set: { groupId, id, data: t, updated_at: new Date() },
          },
          upsert: true,
        },
      };
    });
    await db.collection('tasks').bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.error('[mongo-cache-write] failed', e);
  }
}

// ТОЛЬКО OAuth. Webhook полностью убран.
// + Server-side in-memory cache (30 сек на запрос, 5 мин на projects/users)

const CACHE_TTL = 30 * 1000; // 30 секунд для задач
const PROJECTS_TTL = 5 * 60 * 1000; // 5 минут для проектов/пользователей
const BITRIX24_TIMEOUT_MS = 12_000;
const TASK_DETAILS_TTL = 60 * 1000;

const MUTATION_METHODS = new Set([
  'tasks.task.add',
  'tasks.task.update',
  'tasks.task.delete',
  'sonet_group.create',
  'sonet_group.update',
  'sonet_group.user.add',
  'sonet_group.user.delete',
  'task.commentitem.add',
  'task.commentitem.update',
  'task.commentitem.delete',
  'tasks.task.chat.message.send',
  'task.elapseditem.add',
  'task.elapseditem.update',
  'task.elapseditem.delete',
  'task.stages.add',
  'task.stages.delete',
  'task.stages.update',
  'task.checklistitem.add',
  'task.checklistitem.update',
  'task.checklistitem.delete',
  'task.checklistitem.complete',
  'task.checklistitem.renew',
]);
const JSON_PAYLOAD_METHODS = new Set([
  'tasks.task.list',
  'tasks.task.add',
  'tasks.task.update',
  'tasks.task.chat.message.send',
]);
const REST_V3_METHODS = new Set(['tasks.task.chat.message.send']);

function getCacheTtl(method: string): number {
  if (method === 'task.stages.get') return PROJECTS_TTL;
  if (method === 'task.commentitem.getlist' || method === 'task.elapseditem.getlist')
    return TASK_DETAILS_TTL;
  return CACHE_TTL;
}

function getBitrixResult(method: string, data: any) {
  if (method === 'tasks.task.list' && data.result && typeof data.result === 'object') {
    return {
      ...data.result,
      next: data.next,
      total: data.total,
    };
  }

  return data.result;
}

async function handleRequest(req: NextRequest, method: string) {
  if (isMockEnabled()) {
    const params: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    try {
      const body = await req.text();
      if (body) {
        const bodyParams = new URLSearchParams(body);
        bodyParams.forEach((value, key) => {
          params[key] = value;
        });
      }
    } catch {}

    const result = mockHandle(method, params);
    if (result === null) {
      return NextResponse.json({ error: 'NOT_MOCKED', method }, { status: 501 });
    }

    // Маппинг для совместимости с UI: bitrix-style ответа в result.
    if (method === 'task.stages.get') {
      const stages = Array.isArray(result) ? result : Object.values(result || {});
      const mapped = stages.map((s: any) => ({
        id: s.ID,
        name: s.TITLE,
        color: s.COLOR,
        sort: parseInt(s.SORT) || 100,
        systemType: s.SYSTEM_TYPE || '',
        entityId: s.ENTITY_ID,
      }));
      return NextResponse.json({ result: mapped });
    }

    if (method === 'tasks.task.list') {
      const taskResult = result as { tasks?: any[]; next?: number; total?: number };
      const tasksList = taskResult.tasks || (Array.isArray(result) ? result : []);
      const mapped = tasksList.map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description || '',
        status: t.status,
        subStatus: t.subStatus,
        priority: t.priority,
        createdDate: t.createdDate,
        changedDate: t.changedDate,
        deadline: t.deadline || undefined,
        timeEstimate: parseInt(t.timeEstimate) || 0,
        timeSpentInLogs: parseInt(t.timeSpentInLogs) || 0,
        groupId: t.groupId || t.group_id || '0',
        groupName: t.groupName || t.group_name || 'No Project',
        responsibleId: t.responsibleId || t.responsible_id || '',
        responsibleName: t.responsibleName || t.responsible_name || 'Unassigned',
        responsibleIcon: t.responsibleIcon,
        creatorId: t.creatorId || t.creator_id || '',
        creatorName: t.creatorName || t.creator_name || '',
        commentsCount: parseInt(t.commentsCount) || 0,
        parentId: t.parentId || undefined,
        stageId: t.stageId || '0',
      }));
      return NextResponse.json({
        result: {
          tasks: mapped,
          next: taskResult.next,
          total: taskResult.total,
        },
      });
    }

    if (method === 'im.dialog.messages.get') {
      const r = result as { messages: any[] };
      return NextResponse.json({ result: r });
    }

    if (method === 'task.elapseditem.getlist') {
      return NextResponse.json({ result });
    }

    return NextResponse.json({ result });
  }

  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);

  if (!memberId) {
    return NextResponse.json(
      {
        error: 'AUTHORIZATION_REQUIRED',
        message: 'Нужна авторизация через /install или /api/oauth',
      },
      { status: 401 },
    );
  }

  // Собираем параметры
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  try {
    const body = await req.text();
    if (body) {
      const bodyParams = new URLSearchParams(body);
      bodyParams.forEach((value, key) => {
        params[key] = value;
      });
    }
  } catch {}

  // Получаем токен
  let token;
  try {
    const db = await getDb();
    token = await db.collection('user_tokens').findOne({ member_id: memberId });
  } catch (err: any) {
    return NextResponse.json({ error: 'MONGO_ERROR', message: err.message }, { status: 500 });
  }

  if (!token?.access_token) {
    return NextResponse.json(
      {
        error: 'NO_TOKEN',
        message: 'Нет OAuth токена. Переустановите приложение',
      },
      { status: 401 },
    );
  }

  // Read-запросы к Bitrix24 кэшируются и дедуплицируются. Записи всегда идут
  // напрямую и очищают кэш текущего портала.
  let result: any;
  try {
    if (MUTATION_METHODS.has(method)) {
      result = await callBitrix24(token, method, params);
      invalidateByPrefix(`${memberId}:`);
    } else {
      // ponytail: на холодном старте serverCache пуст, и каждый запрос летит
      // в Битрикс напрямую (10+ проектов × 200-800мс = секунды на первый рендер).
      // Сначала проверяем MongoDB-кэш (он переживает рестарт) — если данные есть,
      // Битрикс вообще не трогаем. Это и есть причина медленного первого апдейта.
      const cached = await mongoTasksCacheRead(method, params);
      if (cached) {
        result = cached;
      } else {
        const cacheKey = `${memberId}:${method}:${JSON.stringify(params)}`;
        result = await serverCache(
          cacheKey,
          async () => {
            const data = await callBitrix24(token, method, params);
            // Фоновая запись в MongoDB — чтобы следующий запрос попал в кэш
            void mongoTasksCacheWrite(method, params, data).catch(() => {});
            return data;
          },
          getCacheTtl(method),
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bitrix24 request failed';
    const timedOut = message === 'BITRIX24_TIMEOUT';
    return NextResponse.json(
      {
        error: timedOut ? 'BITRIX24_TIMEOUT' : 'BITRIX24_REQUEST_FAILED',
        message: timedOut ? 'Bitrix24 did not respond in time. Please try again.' : message,
      },
      { status: timedOut ? 504 : 502 },
    );
  }

  // Маппим ответы для совместимости с UI (lowercase keys)
  if (method === 'task.stages.get') {
    const stages = Array.isArray(result) ? result : Object.values(result || {});
    const mapped = stages.map((s: any) => ({
      id: s.ID,
      name: s.TITLE,
      color: s.COLOR,
      sort: parseInt(s.SORT) || 100,
      systemType: s.SYSTEM_TYPE || '',
      entityId: s.ENTITY_ID,
    }));
    return NextResponse.json({ result: mapped });
  }

  if (method === 'tasks.task.list') {
    const taskResult = result as { tasks?: any[]; next?: number; total?: number };
    const tasksList = taskResult.tasks || (Array.isArray(result) ? result : []);
    const mapped = tasksList.map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description || '',
      status: t.status,
      subStatus: t.subStatus,
      priority: t.priority,
      createdDate: t.createdDate,
      changedDate: t.changedDate,
      deadline: t.deadline || undefined,
      timeEstimate: parseInt(t.timeEstimate) || 0,
      timeSpentInLogs: parseInt(t.timeSpentInLogs) || 0,
      groupId: t.group?.id || t.groupId || t.group_id || '0',
      groupName: t.group?.name || t.groupName || t.group_name || 'No Project',
      responsibleId: t.responsible?.id || t.responsibleId || t.responsible_id || '',
      responsibleName:
        t.responsible?.name || t.responsibleName || t.responsible_name || 'Unassigned',
      responsibleIcon: t.responsible?.icon || t.responsibleIcon,
      creatorId: t.creator?.id || t.creatorId || t.creator_id || '',
      creatorName: t.creator?.name || t.creatorName || t.creator_name || '',
      commentsCount: parseInt(t.commentsCount) || 0,
      parentId: t.parentId || undefined,
      stageId: t.stageId || '0',
    }));
    return NextResponse.json({
      result: {
        tasks: mapped,
        next: taskResult.next,
        total: taskResult.total,
      },
    });
  }

  return NextResponse.json({ result });
}

async function callBitrix24(
  token: any,
  method: string,
  params: Record<string, string>,
): Promise<any> {
  const getUrl = (accessToken: string) => {
    const domain = token.domain || 'eora.bitrix24.ru';
    const apiPath = REST_V3_METHODS.has(method) ? 'rest/api' : 'rest';
    return `https://${domain}/${apiPath}/${method}?auth=${accessToken}`;
  };
  const url = getUrl(token.access_token);

  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await postBitrixJson(
        url,
        getPayload(method, params),
        JSON_PAYLOAD_METHODS.has(method),
      );

      if (data.error === 'expired_token' || data.error === 'invalid_token') {
        const refreshed = await refreshToken(token);
        if (refreshed) {
          const retryUrl = getUrl(refreshed);
          const retryData = await postBitrixJson(
            retryUrl,
            getPayload(method, params),
            JSON_PAYLOAD_METHODS.has(method),
          );
          if (!retryData.error) return getBitrixResult(method, retryData);
        }
        throw new Error('Token expired and refresh failed');
      }

      if (data.error) {
        throw new Error(`${data.error}: ${data.error_description}`);
      }

      return getBitrixResult(method, data);
    } catch (err: any) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error('BITRIX24_TIMEOUT');
      }
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 500));
        continue;
      }
    }
  }
  throw lastError;
}

function getPayload(method: string, params: Record<string, string>): Record<string, unknown> {
  if (method === 'tasks.task.chat.message.send') {
    return { fields: { taskId: Number(params.taskId), text: params.text } };
  }

  if (method === 'tasks.task.add' || method === 'tasks.task.update') {
    const payload: Record<string, unknown> = { ...params };
    if (typeof params.fields === 'string') {
      try {
        payload.fields = JSON.parse(params.fields);
      } catch {
        // Let Bitrix return a validation error for malformed caller input.
      }
    }
    return payload;
  }

  if (method !== 'tasks.task.list') return params;

  const payload: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    const nested = key.match(/^(filter|order|select)\[([^\]]+)\]$/);
    if (!nested) {
      payload[key] = value;
      continue;
    }
    const [, field, childKey] = nested;
    if (field === 'select') {
      payload.select ||= [];
      payload.select[Number(childKey)] = value;
    } else {
      payload[field] ||= {};
      payload[field][childKey] = value;
    }
  }
  return payload;
}

async function refreshToken(token: any): Promise<string | null> {
  if (!token.refresh_token) return null;

  const CLIENT_ID = process.env.BITRIX24_CLIENT_ID || '';
  const CLIENT_SECRET = process.env.BITRIX24_CLIENT_SECRET || '';

  try {
    const res = await fetch('https://oauth.bitrix.info/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: token.refresh_token,
      }),
    });

    const data = await res.json();
    if (data.error) return null;

    const db = await getDb();
    await db.collection('user_tokens').updateOne(
      { member_id: token.member_id },
      {
        $set: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          updated_at: new Date(),
        },
      },
    );

    // Очищаем кеш чтобы перезагрузить
    invalidateByPrefix(token.member_id);

    return data.access_token;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleRequest(req, path.join('.'));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleRequest(req, path.join('.'));
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
