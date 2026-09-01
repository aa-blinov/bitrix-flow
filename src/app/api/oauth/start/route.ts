import { NextRequest, NextResponse } from 'next/server';

const CLIENT_ID = process.env.BITRIX24_CLIENT_ID || '';
const REDIRECT_URI =
  process.env.BITRIX24_REDIRECT_URI || 'https://bitrix-flow.duckdns.org/api/oauth';

// Запуск OAuth flow - редирект на Bitrix24
export async function GET(req: NextRequest) {
  if (!CLIENT_ID) {
    return NextResponse.json(
      {
        error: 'BITRIX24_CLIENT_ID not set in .env.local',
      },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') || 'tasks,sonet_group,user,calendar,im,crm,disk';
  const state = crypto.randomUUID();

  const authUrl =
    `https://oauth.bitrix.info/oauth/authorize/?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope,
      state,
    });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set({
    name: 'bitrix-oauth-state',
    value: state,
    httpOnly: true,
    sameSite: 'lax',
    secure: REDIRECT_URI.startsWith('https://'),
    path: '/api/oauth',
    maxAge: 10 * 60,
  });
  return response;
}
