import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { loadHours } from '@/lib/hours';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const from = req.nextUrl.searchParams.get('from') || '';
  const to = req.nextUrl.searchParams.get('to') || '';
  if (!DAY.test(from) || !DAY.test(to) || from > to) {
    return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  }
  return NextResponse.json(await loadHours(memberId, from, to));
}
