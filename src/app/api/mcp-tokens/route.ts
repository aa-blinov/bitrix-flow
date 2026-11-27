import { NextRequest, NextResponse } from 'next/server';
import { issueMcpToken, listMcpTokens, revokeMcpToken } from '@/lib/mcp-tokens';
import { getSessionPerson } from '@/lib/people';
import { sessionCookie } from '@/lib/session';
import { audit } from '@/lib/users';

export const dynamic = 'force-dynamic';

// Токен выпускает себе сам человек и только при привязке к Битриксу: без неё MCP всё равно
// ничего бы не отдал, а токен без пользы лишь расширял бы поверхность входа.
async function person(req: NextRequest) {
  return getSessionPerson(req.cookies.get(sessionCookie.name)?.value);
}
const unauthorized = () => NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

export async function GET(req: NextRequest) {
  const who = await person(req);
  if (!who) return unauthorized();
  return NextResponse.json({ tokens: await listMcpTokens(String(who.user._id)) });
}

export async function POST(req: NextRequest) {
  const who = await person(req);
  if (!who) return unauthorized();
  const body = await req.json().catch(() => null);
  const result = await issueMcpToken(String(who.user._id), String(body?.name ?? ''));
  if ('error' in result) return NextResponse.json(result, { status: 409 });
  await audit(who.user.username, 'mcp-token-issue', result.id);
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const who = await person(req);
  if (!who) return unauthorized();
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!(await revokeMcpToken(String(who.user._id), id)))
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  await audit(who.user.username, 'mcp-token-revoke', id);
  return NextResponse.json({ ok: true });
}
