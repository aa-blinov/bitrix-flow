import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { postBitrixJson } from '@/lib/bitrix-request';
import { bx24OAuth } from '@/lib/oauth-client';
import { savePersonToken } from '@/lib/people';
import { getProtectedMemberId } from '@/lib/portal';
import { safeNext, isSecureOrigin, startSession } from '@/lib/login-cookie';
import { sessionCookie } from '@/lib/session';
import { getSessionUser, revokeStoredSession } from '@/lib/session-store';
import { accountForBitrix, audit, markLogin } from '@/lib/users';

const CLIENT_ID = process.env.BITRIX24_CLIENT_ID || '';
const CLIENT_SECRET = process.env.BITRIX24_CLIENT_SECRET || '';
// Bitrix24 в маркетплейс-flow редиректит сюда же, на /api/oauth. Это рабочий
// и одобренный redirect_uri для нашего приложения.
const APP_URL = process.env.BITRIX24_APP_URL || 'https://bitrix-flow.duckdns.org';
const REDIRECT_URI = process.env.BITRIX24_REDIRECT_URI || `${APP_URL}/api/oauth`;
const SCOPE = 'tasks,sonet_group,user,calendar,im';

const STATE_COOKIE = 'bitrix-oauth-state';
const NEXT_COOKIE = 'bitrix-oauth-next';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (code) {
    const state = url.searchParams.get('state');
    const expectedState = req.cookies.get(STATE_COOKIE)?.value;
    // Вход через Битрикс всегда несёт state: без него ответ мог прийти из чужой вкладки
    // (CSRF), и человек вошёл бы под чужим Битриксом.
    if (expectedState) {
      if (state !== expectedState)
        return NextResponse.json({ error: 'OAUTH_STATE_INVALID' }, { status: 400 });
      return handleLogin(code, req, url.searchParams.get('domain') || undefined);
    }
    // Без state это установка или переустановка приложения из самого портала.
    return handleInstallCallback(code, url.searchParams.get('domain') || undefined);
  }

  // Если есть member_id и auth - это прямая установка из маркетплейса
  const memberId = url.searchParams.get('member_id');
  if (memberId) {
    return await handleInstall(memberId, url);
  }

  // Вход через Битрикс: state в HttpOnly-куке, авторизация на самом портале.
  const stateValue = randomBytes(24).toString('base64url');
  const portalDomain = await currentPortalDomain();
  const authUrl =
    `https://${portalDomain || 'oauth.bitrix.info'}/oauth/authorize/?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state: stateValue,
    });
  const response = NextResponse.redirect(authUrl);
  const cookie = { httpOnly: true, sameSite: 'lax' as const, secure: isSecureOrigin(), path: '/' };
  response.cookies.set({ name: STATE_COOKIE, value: stateValue, maxAge: 600, ...cookie });
  response.cookies.set({
    name: NEXT_COOKIE,
    value: safeNext(url.searchParams.get('next')),
    maxAge: 600,
    ...cookie,
  });
  return response;
}

async function currentPortalDomain(): Promise<string> {
  const memberId = await getProtectedMemberId();
  if (!memberId) return '';
  const token = await (
    await getDb()
  )
    .collection('user_tokens')
    .findOne({ member_id: memberId }, { projection: { domain: 1 } });
  const domain = String(token?.domain || '');
  return /^[a-z0-9.-]+$/i.test(domain) ? domain : '';
}

type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  member_id: string;
  scope?: string;
  client_endpoint?: string;
  application_token?: string;
  error?: string;
  error_description?: string;
};

async function exchange(code: string): Promise<Tokens> {
  const tokenRes = await fetch('https://oauth.bitrix.info/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  return tokenRes.json();
}

// OAuth возвращает `domain` авторизационного сервера. Для REST нужен
// hostname из client_endpoint, например eora.bitrix24.ru.
function restDomainOf(tokens: Tokens, portalDomain?: string) {
  return tokens.client_endpoint ? new URL(tokens.client_endpoint).hostname : portalDomain;
}

async function whoIs(domain: string, accessToken: string) {
  const data = await postBitrixJson(`https://${domain}/rest/user.current?auth=${accessToken}`, {});
  const id = String(data?.result?.ID || '');
  const name = [data?.result?.NAME, data?.result?.LAST_NAME].filter(Boolean).join(' ');
  return /^\d+$/.test(id) ? { id, name: name || `#${id}` } : null;
}

/** Чей токен у портала: этот человек при первом входе получает свою прежнюю админскую учётку. */
async function portalOwner(memberId: string): Promise<string> {
  const db = await getDb();
  const token = await db.collection('user_tokens').findOne({ member_id: memberId });
  if (token?.owner_user_id) return String(token.owner_user_id);
  const me = await bx24OAuth(memberId, 'user.current', {}, { parallel: true }).catch(() => null);
  const id = String(me?.ID || '');
  if (/^\d+$/.test(id))
    await db
      .collection('user_tokens')
      .updateOne({ member_id: memberId }, { $set: { owner_user_id: id } });
  return id;
}

function loginFailed(reason: string) {
  const target = new URL('/login', APP_URL);
  target.searchParams.set('error', reason);
  const response = NextResponse.redirect(target);
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  return response;
}

async function handleLogin(code: string, req: NextRequest, portalDomain?: string) {
  if (!CLIENT_ID || !CLIENT_SECRET) return loginFailed('oauth_not_configured');
  const tokens = await exchange(code);
  if (tokens.error) return loginFailed('oauth_denied');
  const domain = restDomainOf(tokens, portalDomain);
  if (!domain) return loginFailed('oauth_denied');

  // Пускаем только людей подключённого портала: чужой портал со своим Битриксом сюда
  // не войдёт. Портала ещё нет только до первой установки приложения.
  const portal = await getProtectedMemberId();
  if (portal && tokens.member_id !== portal) return loginFailed('wrong_portal');
  const me = await whoIs(domain, tokens.access_token).catch(() => null);
  if (!me) return loginFailed('oauth_denied');

  await savePersonToken({
    member_id: tokens.member_id,
    user_id: me.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: Number(tokens.expires_in) || 3600,
    domain,
  });
  // Первый вход на чистой установке: токен этого человека становится и токеном портала.
  if (!portal) await savePortalToken(tokens, domain, me.id);

  const account = await accountForBitrix({
    memberId: tokens.member_id,
    userId: me.id,
    name: me.name,
    portalOwner: me.id === (await portalOwner(tokens.member_id)),
    current: await getSessionUser(req.cookies.get(sessionCookie.name)?.value),
  });
  if ('error' in account) return loginFailed('already_linked');
  if (account.blocked) return loginFailed('blocked');
  await markLogin(account._id);
  await audit(String(account._id), 'bitrix-login', `${tokens.member_id}:${me.id}`);

  // Прежняя сессия (вход паролем до привязки) больше не нужна: новая выдаётся ниже.
  await revokeStoredSession(req.cookies.get(sessionCookie.name)?.value).catch(() => {});
  const response = NextResponse.redirect(
    new URL(safeNext(req.cookies.get(NEXT_COOKIE)?.value), APP_URL),
  );
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  return startSession(response, String(account._id), req.headers.get('user-agent'));
}

async function savePortalToken(tokens: Tokens, domain: string, ownerUserId?: string) {
  await (await getDb()).collection('user_tokens').updateOne(
    { member_id: tokens.member_id },
    {
      $set: {
        member_id: tokens.member_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        scope: tokens.scope,
        domain,
        application_token: tokens.application_token,
        ...(ownerUserId ? { owner_user_id: ownerUserId } : {}),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );
}

// Установка или переустановка из портала. Токен портала меняется только на портале, который
// уже подключён (или на чистой установке), и только его владельцем: иначе любой сотрудник,
// прошедший OAuth приложения, подменил бы токен фоновой синхронизации своим.
async function handleInstallCallback(code: string, portalDomain?: string) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json({ error: 'OAuth not configured' }, { status: 500 });
  }
  const tokens = await exchange(code);
  if (tokens.error) {
    return NextResponse.json(
      { error: tokens.error, description: tokens.error_description },
      { status: 400 },
    );
  }
  const restDomain = restDomainOf(tokens, portalDomain);
  if (!restDomain)
    return NextResponse.json({ error: 'OAUTH_PORTAL_DOMAIN_MISSING' }, { status: 400 });

  const portal = await getProtectedMemberId();
  if (portal && tokens.member_id !== portal) return loginFailed('wrong_portal');
  const me = await whoIs(restDomain, tokens.access_token).catch(() => null);
  const owner = portal ? await portalOwner(portal) : '';
  // Владелец неизвестен (токен портала протух до того, как его записали): переустановку
  // не принимаем ни от кого, иначе любой сотрудник стал бы владельцем и администратором.
  if (portal && (!me || !owner || me.id !== owner)) return loginFailed('not_portal_owner');
  await savePortalToken(tokens, restDomain, me?.id);

  // Регистрируем обработчик событий
  try {
    // Адрес берём из конфига, а не из Host/X-Forwarded-Proto: заголовки шлёт
    // клиент, и подменённый Host вешал бы события портала на чужой адрес.
    const handlerUrl = new URL('/api/b24/handler', APP_URL).href;
    for (const event of ['OnTaskAdd', 'OnTaskUpdate', 'OnTaskDelete', 'OnTaskCommentAdd']) {
      await postBitrixJson(`https://${restDomain}/rest/event.bind?auth=${tokens.access_token}`, {
        event,
        handler: handlerUrl,
      });
    }
  } catch (e) {
    console.error('Failed to bind events:', e);
  }

  const successUrl = new URL('/', APP_URL);
  successUrl.searchParams.set('oauth', 'success');
  return NextResponse.redirect(successUrl);
}

// Прямая установка из маркетплейса (AUTH в адресе). Тот же запрет: чужой портал и токен
// поверх уже подключённого портала сюда не пишутся.
async function handleInstall(memberId: string, url: URL) {
  const auth = url.searchParams.get('AUTH');
  const domain = url.searchParams.get('DOMAIN') || '';

  if (!auth) {
    return NextResponse.redirect(new URL('/api/oauth', APP_URL));
  }
  const portal = await getProtectedMemberId();
  if (portal) return NextResponse.json({ error: 'ALREADY_INSTALLED' }, { status: 409 });

  const db = await getDb();
  await db.collection('user_tokens').updateOne(
    { member_id: memberId },
    {
      $set: {
        member_id: memberId,
        access_token: auth,
        domain,
        application_token: url.searchParams.get('APPLICATION_TOKEN') || undefined,
        installed_at: new Date(),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );

  const successUrl = new URL('/', APP_URL);
  successUrl.searchParams.set('install', 'success');
  return NextResponse.redirect(successUrl);
}
