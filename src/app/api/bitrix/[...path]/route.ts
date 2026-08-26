import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { serverCache, invalidateByPrefix } from '@/lib/server-cache';
import { postBitrixJson } from '@/lib/bitrix-request';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

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
  'task.commentitem.add',
  'task.commentitem.update',
  'task.commentitem.delete',
  'task.elapseditem.add',
  'task.elapseditem.update',
  'task.elapseditem.delete',
]);
const JSON_PAYLOAD_METHODS = new Set(['tasks.task.list', 'tasks.task.add', 'tasks.task.update']);

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
      const cacheKey = `${memberId}:${method}:${JSON.stringify(params)}`;
      result = await serverCache(
        cacheKey,
        async () => {
          return await callBitrix24(token, method, params);
        },
        getCacheTtl(method),
      );
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
  console.log('[proxy] method:', method, 'isArray:', Array.isArray(result), 'type:', typeof result);

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
  const url = token.domain
    ? `https://${token.domain}/rest/${method}?auth=${token.access_token}`
    : `https://eora.bitrix24.ru/rest/${method}?auth=${token.access_token}`;

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
          const retryUrl = token.domain
            ? `https://${token.domain}/rest/${method}?auth=${refreshed}`
            : `https://eora.bitrix24.ru/rest/${method}?auth=${refreshed}`;
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
