import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';

const CLIENT_ID = process.env.BITRIX24_CLIENT_ID || '';
const CLIENT_SECRET = process.env.BITRIX24_CLIENT_SECRET || '';
// Bitrix24 в маркетплейс-flow редиректит сюда же, на /api/oauth. Это рабочий
// и одобренный redirect_uri для нашего приложения.
const APP_URL = process.env.BITRIX24_APP_URL || 'https://bitrix-flow.duckdns.org';
const REDIRECT_URI =
  process.env.BITRIX24_REDIRECT_URI || `${APP_URL}/api/oauth`;

// Стартовая точка OAuth flow
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  // Если есть code - это callback после авторизации
  if (code) {
    // Bitrix24 в маркетплейс-flow не передаёт state (state всегда пустой),
    // поэтому пропускаем проверку только если state реально ожидался.
    const state = url.searchParams.get('state');
    const expectedState = req.cookies.get('bitrix-oauth-state')?.value;
    if (expectedState && state !== expectedState) {
      return NextResponse.json({ error: 'OAUTH_STATE_INVALID' }, { status: 400 });
    }
    return await handleCallback(code, req);
  }

  // Если есть member_id и auth - это прямая установка из маркетплейса
  const memberId = url.searchParams.get('member_id');
  if (memberId) {
    return await handleInstall(memberId, url, req);
  }

  // Редирект на OAuth авторизацию
  const authUrl =
    `https://oauth.bitrix.info/oauth/authorize/?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'tasks,sonet_group,user,calendar,im',
    });

  return NextResponse.redirect(authUrl);
}

async function handleCallback(code: string, req: NextRequest) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json({ error: 'OAuth not configured' }, { status: 500 });
  }

  // Обмениваем code на токены
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

  const tokens = await tokenRes.json();

  if (tokens.error) {
    return NextResponse.json(
      {
        error: tokens.error,
        description: tokens.error_description,
      },
      { status: 400 },
    );
  }

  // Сохраняем токен в MongoDB
  const db = await getDb();
  await db.collection('user_tokens').updateOne(
    { member_id: tokens.member_id },
    {
      $set: {
        member_id: tokens.member_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        scope: tokens.scope,
        domain: tokens.domain,
        application_token: tokens.application_token,
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );

  // Регистрируем обработчик событий
  try {
    const host = req.headers.get('host') || '57.131.129.41:3000';
    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const handlerUrl = `${protocol}://${host}/api/b24/handler`;

    for (const event of ['OnTaskAdd', 'OnTaskUpdate', 'OnTaskDelete', 'OnTaskCommentAdd']) {
      await fetch(`https://${tokens.domain}/rest/event.bind?auth=${tokens.access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ event, handler: handlerUrl }),
      });
    }
  } catch (e) {
    console.error('Failed to bind events:', e);
  }

  // Редирект в приложение
  const successUrl = new URL('/', APP_URL);
  successUrl.searchParams.set('oauth', 'success');
  successUrl.searchParams.set('member_id', tokens.member_id);
  return NextResponse.redirect(successUrl);
}

async function handleInstall(memberId: string, url: URL, req: NextRequest) {
  const auth = url.searchParams.get('AUTH');
  const domain = url.searchParams.get('DOMAIN') || '';

  if (!auth) {
    return NextResponse.redirect(new URL('/api/oauth', APP_URL));
  }

  // Сохраняем токен установки
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
  successUrl.searchParams.set('member_id', memberId);
  return NextResponse.redirect(successUrl);
}
