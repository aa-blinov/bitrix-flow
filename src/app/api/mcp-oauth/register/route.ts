import { NextRequest, NextResponse } from 'next/server';
import { registerClient } from '@/lib/mcp-oauth';

export const dynamic = 'force-dynamic';

// Регистрация открыта по RFC 7591, иначе коннектор не подключится. Сама по себе она доступа не
// даёт: токен выдаётся только после входа и согласия человека. Лимит на адрес не даёт засыпать
// базу регистрациями, брошенные клиенты убирает TTL.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: NextRequest) {
  // X-Real-IP перезаписывает Caddy, X-Forwarded-For клиент подделывает: как во входе.
  const forwarded = req.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim());
  const ip = req.headers.get('x-real-ip')?.trim() || forwarded?.at(-1) || 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);
  const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
  current.count += 1;
  hits.set(ip, current);
  if (current.count > MAX_PER_WINDOW)
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object')
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  const result = await registerClient(body);
  if ('error' in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
