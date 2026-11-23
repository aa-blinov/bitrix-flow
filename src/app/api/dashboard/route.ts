import { NextRequest, NextResponse } from 'next/server';
import { portalDay, usableAvatar } from '@/lib/utils';
import { getDb } from '@/lib/mongo';
import { serverCache, invalidateByPrefix } from '@/lib/server-cache';
import { postBitrixJson } from '@/lib/bitrix-request';
import { getAuthorizedPerson } from '@/lib/authorized-member';
import { bx24OAuth } from '@/lib/oauth-client';
import { sessionCookie } from '@/lib/session';
import { isMockEnabled, mockHandle } from '@/lib/mock-b24';
import { hoursSettings } from '@/lib/hours-settings';

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
        keywords: g.KEYWORDS || '',
        startDate: portalDay(g.PROJECT_DATE_START),
        finishDate: portalDay(g.PROJECT_DATE_FINISH),
      })),
      projectDates: true,
      ...splitUsers(rawUsers),
      currentUser: rawCurrentUser
        ? {
            id: rawCurrentUser.ID,
            name: `${rawCurrentUser.NAME} ${rawCurrentUser.LAST_NAME || ''}`.trim(),
            photo: undefined,
          }
        : null,
    });
  }

  const person = await getAuthorizedPerson(req.cookies.get(sessionCookie.name)?.value);
  const memberId = person?.memberId;

  if (!person || !memberId) {
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
  const hasMirror = await db2
    .collection('task_mirror')
    .findOne({ member_id: memberId }, { projection: { _id: 1 } });
  if (!hasMirror) {
    await db2.collection('task_mirror').deleteMany({ member_id: memberId });
    await db2.collection('projects').deleteMany({ member_id: memberId });
    await db2.collection('tasks').deleteMany({ member_id: memberId });
  }

  // Параллельно загружаем все что нужно для дашборда
  const PROJECTS_TTL = 5 * 60 * 1000;

  try {
    const [rawProjects, projectDates, rawUsers, rawCurrentUser] = await Promise.all([
      serverCache(`${memberId}:projects:all`, () => fetchAllProjects(token), PROJECTS_TTL),
      serverCache(`${memberId}:projects:dates`, () => fetchProjectDates(token), PROJECTS_TTL),
      // Без фильтра ACTIVE: портал отдаёт и неактивных, их имена нужны подписям в задачах.
      serverCache(`${memberId}:users:all:v4`, () => fetchPeople(token, memberId), PROJECTS_TTL),
      // «Я» это вошедший человек, а не владелец токена портала: его токеном и в его ключ кэша.
      serverCache(
        `${memberId}:user:current:${person.userId}`,
        () => bx24OAuth(memberId, 'user.current', {}, { parallel: true, asUser: person.userId }),
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
      keywords: g.KEYWORDS || '',
      startDate: projectDates?.[String(g.ID)]?.start || '',
      finishDate: projectDates?.[String(g.ID)]?.finish || '',
    }));

    const { users, hiddenUsers } = splitUsers(rawUsers);

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

    return NextResponse.json({
      projects,
      projectDates: !!projectDates,
      users,
      hiddenUsers,
      currentUser,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Неактивную экстранет-учётку (служебная 15) user.get не отдаёт ни без фильтра, ни с
// ACTIVE: 'N', только по номеру. Поэтому дозапрашиваем по ID тех, кто встречается в задачах
// зеркала и в настройках часов, но не пришёл списком: иначе в отчётах «#15» вместо имени.
async function fetchPeople(token: any, memberId: string) {
  const users = await allPages(token, 'user.get');
  const known = new Set(users.map((user) => String(user.ID)));
  const db = await getDb();
  const filter = { member_id: memberId };
  const mirror = db.collection('task_mirror');
  const seen = await Promise.all([
    mirror.distinct('data.responsibleId', filter),
    mirror.distinct('data.responsible.id', filter),
    mirror.distinct('data.createdBy', filter),
    mirror.distinct('data.creator.id', filter),
    hoursSettings().then((settings) => settings.excludedUserIds),
  ]);
  const missing = [...new Set(seen.flat().map(String))].filter(
    (id) => /^\d+$/.test(id) && id !== '0' && !known.has(id),
  );
  if (!missing.length) return users;
  const extra = await allPages(
    token,
    'user.get',
    Object.fromEntries(missing.map((id, index) => [`ID[${index}]`, id])),
  ).catch(() => []);
  return [...users, ...extra];
}

// В выбор людей и списки идут только активные сотрудники. Неактивные и внешние (экстранет,
// гости по почте) остаются подписью к задачам, где они уже стоят, чтобы не было «#15».
function splitUsers(raw: any[] | null) {
  const users = (raw || []).map((u: any) => ({
    id: u.ID,
    name: `${u.NAME || ''} ${u.LAST_NAME || ''}`.trim() || u.EMAIL,
    email: u.EMAIL,
    icon: usableAvatar(u.PERSONAL_PHOTO),
    userType: u.USER_TYPE,
    active: u.ACTIVE !== false && u.ACTIVE !== 'N',
  }));
  return {
    users: users.filter(isStaff).map(({ active: _active, ...user }) => user),
    hiddenUsers: users.filter((user) => !isStaff(user)).map(({ id, name }) => ({ id, name })),
  };
}

async function callBitrix24Response(token: any, method: string, params: Record<string, string>) {
  let data = await callBitrix24WithToken(token, method, params);
  if (data.error === 'expired_token' || data.error === 'invalid_token') {
    const refreshedToken = await refreshToken(token);
    if (!refreshedToken) throw new Error('TOKEN_REFRESH_FAILED');
    data = await callBitrix24WithToken({ ...token, access_token: refreshedToken }, method, params);
  }
  if (data.error) throw new Error(`${data.error}: ${data.error_description}`);
  return data;
}

const isStaff = (user: { active: boolean; userType?: string }) =>
  user.active && user.userType !== 'extranet' && user.userType !== 'email';

// Портал отдаёт по 50 записей и номер следующей страницы в next. visited спасает от
// петли, если портал вернёт тот же next.
async function allPages(token: any, method: string, params: Record<string, string> = {}) {
  const items: any[] = [];
  const visited = new Set<number>();
  for (let start = 0; !visited.has(start);) {
    visited.add(start);
    const data = await callBitrix24Response(token, method, { ...params, start: String(start) });
    items.push(...(data.result || []));
    if (data.next === undefined || data.next === null) break;
    start = Number(data.next);
  }
  return items;
}

const fetchAllProjects = (token: any) => allPages(token, 'sonet_group.get');

// sonet_group.get сроков проекта не отдаёт (проверено на живом портале), их знает только
// socialnetwork.api, а ему нужно право socialnetwork. Без права возвращаем null, и интерфейс
// прячет сроки: иначе у всех проектов было бы «Сроки не заданы», а сохранённые даты пропадали.
async function fetchProjectDates(
  token: any,
): Promise<Record<string, { start: string; finish: string }> | null> {
  const dates: Record<string, { start: string; finish: string }> = {};
  const visited = new Set<number>();
  let start = 0;
  try {
    while (!visited.has(start)) {
      visited.add(start);
      const data = await callBitrix24Response(token, 'socialnetwork.api.workgroup.list', {
        'select[0]': 'ID',
        'select[1]': 'PROJECT_DATE_START',
        'select[2]': 'PROJECT_DATE_FINISH',
        start: String(start),
      });
      // Новый API кладёт строки в workgroups и бывает, что в camelCase: принимаем оба вида.
      const rows = Array.isArray(data.result) ? data.result : data.result?.workgroups || [];
      for (const g of rows) {
        dates[String(g.ID ?? g.id)] = {
          start: portalDay(g.PROJECT_DATE_START ?? g.projectDateStart),
          finish: portalDay(g.PROJECT_DATE_FINISH ?? g.projectDateFinish),
        };
      }
      if (data.next === undefined || data.next === null) break;
      start = Number(data.next);
    }
    return dates;
  } catch (error) {
    if (!/insufficient_scope/i.test(String(error)))
      console.warn('[dashboard] сроки проектов не прочитались:', error);
    return null;
  }
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

  const response = await fetch('https://oauth.bitrix.info/oauth/token/', {
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
