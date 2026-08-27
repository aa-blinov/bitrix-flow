import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { serverCache, invalidateByPrefix } from '@/lib/server-cache';
import { postBitrixJson } from '@/lib/bitrix-request';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { isMockEnabled, mockHandle } from '@/lib/mock-b24';
import { getOAuthTokenUrl } from '@/lib/bitrix-oauth-server';

// Batch endpoint - загружает все данные для дашборда одним запросом
export async function GET(req: NextRequest) {
  if (isMockEnabled()) {
    const rawProjects = mockHandle('sonet_group.get', {}) as any[];
    const rawUsers = mockHandle('user.get', {}) as any[];
    const rawCurrentUser = mockHandle('user.current', {}) as any;
    return NextResponse.json({
      projects: (rawProjects || []).map((g: any) => ({
        id: g.ID,
        name: g.NAME || 'Project',
        description: g.DESCRIPTION || '',
        membersCount: parseInt(g.NUMBER_OF_MEMBERS) || 0,
        image: g.IMAGE || undefined,
        isArchived: g.CLOSED === 'Y',
      })),
      users: (rawUsers || []).map((u: any) => ({
        id: u.ID,
        name: `${u.NAME || ''} ${u.LAST_NAME || ''}`.trim() || u.EMAIL,
        email: u.EMAIL,
        icon: u.PERSONAL_PHOTO,
      })),
      currentUser: rawCurrentUser
        ? {
            id: rawCurrentUser.ID,
            name: `${rawCurrentUser.NAME} ${rawCurrentUser.LAST_NAME || ''}`.trim(),
            photo: undefined,
          }
        : null,
    });
  }

  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);

  if (!memberId) {
    return NextResponse.json({ error: 'AUTHORIZATION_REQUIRED' }, { status: 401 });
  }

  let token;
  try {
    const db = await getDb();
    token = await db.collection('user_tokens').findOne({ member_id: memberId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!token?.access_token) {
    return NextResponse.json({ error: 'NO_TOKEN' }, { status: 401 });
  }

  // Sanity: при наличии токена в OAuth-кабинете Bitrix, но пустом состоянии
  // данных, сбрасываем старые данные этого member_id и заставляем клиента
  // пересинхронизироваться с нуля.
  const db2 = await getDb();
  const hasMirror = await db2.collection('task_mirror').findOne({ member_id: memberId }, { projection: { _id: 1 } });
  if (!hasMirror) {
    await db2.collection('task_mirror').deleteMany({ member_id: memberId });
    await db2.collection('projects').deleteMany({ member_id: memberId });
    await db2.collection('tasks').deleteMany({ member_id: memberId });
  }

  // Параллельно загружаем все что нужно для дашборда
  const PROJECTS_TTL = 5 * 60 * 1000;

  try {
    const [rawProjects, rawUsers, rawCurrentUser] = await Promise.all([
      serverCache(
        `${memberId}:projects:all`,
        () => callBitrix24(token, 'sonet_group.get', {}),
        PROJECTS_TTL,
      ),
      serverCache(
        `${memberId}:users:all`,
        () => callBitrix24(token, 'user.get', { ACTIVE: 'true' }),
        PROJECTS_TTL,
      ),
      serverCache(
        `${memberId}:user:current`,
        () => callBitrix24(token, 'user.current', {}),
        PROJECTS_TTL,
      ),
    ]);

    // Маппим в формат нашего store (id, name, etc.)
    const projects = (rawProjects || []).map((g: any) => ({
      id: g.ID,
      name: g.NAME || 'Project',
      description: g.DESCRIPTION || '',
      membersCount: parseInt(g.NUMBER_OF_MEMBERS) || 0,
      image: g.IMAGE || undefined,
      isArchived: g.CLOSED === 'Y',
    }));

    const users = (rawUsers || []).map((u: any) => ({
      id: u.ID,
      name: `${u.NAME || ''} ${u.LAST_NAME || ''}`.trim() || u.EMAIL,
      email: u.EMAIL,
      icon: u.PERSONAL_PHOTO,
    }));

    const currentUser = rawCurrentUser
      ? {
          id: rawCurrentUser.ID || rawCurrentUser.id || '',
          name:
            `${rawCurrentUser.NAME || rawCurrentUser.name || ''} ${rawCurrentUser.LAST_NAME || rawCurrentUser.lastName || ''}`.trim() ||
            'Неизвестный пользователь',
          photo:
            rawCurrentUser.PERSONAL_PHOTO ||
            rawCurrentUser.personalPhoto ||
            rawCurrentUser.photo ||
            undefined,
        }
      : null;

    // Фоновый sync и /api/tasks/all берут проекты из MongoDB. Без этой записи
    // после рестарта им нечего прогревать, и первый открывший приложение
    // пользователь ждёт полный обход Bitrix24.
    if (projects.length > 0) {
      try {
        const db = await getDb();
        await db.collection('projects').bulkWrite(
          projects.map((project: any) => ({
            updateOne: {
              filter: { id: project.id },
              update: { $set: { ...project, member_id: memberId, updated_at: new Date() } },
              upsert: true,
            },
          })),
          { ordered: false },
        );
      } catch {
        // Кэш не должен мешать открыть доску, если MongoDB временно недоступна.
      }
    }

    return NextResponse.json({ projects, users, currentUser });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function callBitrix24(
  token: any,
  method: string,
  params: Record<string, string>,
): Promise<any> {
  const data = await callBitrix24WithToken(token, method, params);
  if (data.error === 'expired_token' || data.error === 'invalid_token') {
    const refreshedToken = await refreshToken(token);
    if (!refreshedToken) throw new Error('TOKEN_REFRESH_FAILED');
    const refreshedData = await callBitrix24WithToken(
      { ...token, access_token: refreshedToken },
      method,
      params,
    );
    if (refreshedData.error)
      throw new Error(`${refreshedData.error}: ${refreshedData.error_description}`);
    return refreshedData.result;
  }
  if (data.error) throw new Error(`${data.error}: ${data.error_description}`);
  return data.result;
}

async function callBitrix24WithToken(token: any, method: string, params: Record<string, string>) {
  const url = token.domain
    ? `https://${token.domain}/rest/${method}?auth=${token.access_token}`
    : `https://eora.bitrix24.ru/rest/${method}?auth=${token.access_token}`;
  return postBitrixJson(url, params);
}

async function refreshToken(token: any): Promise<string | null> {
  if (!token.refresh_token) return null;
  const clientId = process.env.BITRIX24_CLIENT_ID;
  const clientSecret = process.env.BITRIX24_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch(getOAuthTokenUrl(token.oauth_server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
    }),
  });
  const result = await response.json();
  if (result.error || !result.access_token) return null;

  const db = await getDb();
  await db.collection('user_tokens').updateOne(
    { member_id: token.member_id },
    {
      $set: {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        expires_in: result.expires_in,
        updated_at: new Date(),
      },
    },
  );
  invalidateByPrefix(`${token.member_id}:`);
  return result.access_token;
}
