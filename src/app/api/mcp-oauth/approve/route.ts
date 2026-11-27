import { NextRequest, NextResponse } from 'next/server';
import { appOrigin, createCode, findClient, redirectMatches, validResource } from '@/lib/mcp-oauth';
import { getSessionPerson } from '@/lib/people';
import { sessionCookie } from '@/lib/session';
import { audit } from '@/lib/users';

export const dynamic = 'force-dynamic';

// Согласие на странице /oauth/authorize. Ответ это адрес, а не редирект: CSP с form-action 'self'
// не пустил бы редирект формы на адрес клиента, поэтому страница переходит туда сама.
export async function POST(req: NextRequest) {
  // Кука SameSite=lax в чужой POST не уходит, но Origin сверяем всё равно: согласие это выдача
  // доступа, и подделанный запрос с другого сайта не должен дойти до кода.
  if (req.headers.get('origin') !== new URL(appOrigin()).origin)
    return NextResponse.json({ error: 'BAD_ORIGIN' }, { status: 403 });
  const person = await getSessionPerson(req.cookies.get(sessionCookie.name)?.value);
  if (!person) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const client = await findClient(body?.client_id);
  const redirectUri = String(body?.redirect_uri || '');
  // Без проверенного клиента и адреса возврата никуда не уводим: иначе это открытый редирект.
  if (!client || !redirectMatches(client.redirect_uris, redirectUri))
    return NextResponse.json({ error: 'INVALID_CLIENT' }, { status: 400 });

  const target = new URL(redirectUri);
  if (typeof body?.state === 'string' && body.state) target.searchParams.set('state', body.state);
  target.searchParams.set('iss', appOrigin());
  const challenge = String(body?.code_challenge || '');
  if (!body?.approve) {
    target.searchParams.set('error', 'access_denied');
  } else if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !validResource(body?.resource)) {
    target.searchParams.set('error', 'invalid_request');
  } else {
    const code = await createCode({
      client_id: client.client_id,
      user_id: String(person.user._id),
      redirect_uri: redirectUri,
      code_challenge: challenge,
    });
    target.searchParams.set('code', code);
    await audit(person.user.username, 'mcp-oauth-approve', client.client_name);
  }
  return NextResponse.json({ redirect: target.toString() });
}
