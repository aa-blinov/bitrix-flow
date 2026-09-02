import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { getDb } from '@/lib/mongo';
import { getWorkloadTime, refreshWorkloadTime } from '@/lib/workload-time';

function validDay(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

async function memberId(request: NextRequest) {
  return getAuthorizedMemberId(request.cookies.get(sessionCookie.name)?.value);
}

export async function GET(request: NextRequest) {
  const member = await memberId(request);
  const start = request.nextUrl.searchParams.get('start');
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  if (!validDay(start)) return NextResponse.json({ error: 'INVALID_START' }, { status: 400 });
  const [aggregate, status] = await Promise.all([
    getWorkloadTime(member, start!),
    (await getDb()).collection('workload_time_status').findOne({ member_id: member, start }),
  ]);
  return NextResponse.json(
    { data: aggregate || null, refreshing: Boolean(status?.refreshing) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const member = await memberId(request);
  const body = await request.json().catch(() => null);
  const start = typeof body?.start === 'string' ? body.start : null;
  const end = typeof body?.end === 'string' ? body.end : null;
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  if (!validDay(start) || !validDay(end))
    return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  void refreshWorkloadTime(member, start!, end!).catch((error) =>
    console.error('[workload-time]', error),
  );
  return NextResponse.json({ started: true }, { status: 202 });
}
