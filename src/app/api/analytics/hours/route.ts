import { NextRequest, NextResponse, after } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { loadHours, weekStarts } from '@/lib/hours';
import { isMockEnabled } from '@/lib/mock-b24';
import { sessionCookie } from '@/lib/session';
import { markRefreshing, refreshStatus, refreshWorkloadTime } from '@/lib/workload-time';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Полгода: сбор недели стоит меньше секунды, но кнопку жмут руками, и год истории
// держал бы запрос дольше, чем человек готов ждать.
const MAX_REFRESH_WEEKS = 26;

const period = (from: string, to: string) =>
  DAY.test(from) && DAY.test(to) && from <= to ? { from, to } : null;

async function member(req: NextRequest) {
  return getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
}

export async function GET(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const range = period(
    req.nextUrl.searchParams.get('from') || '',
    req.nextUrl.searchParams.get('to') || '',
  );
  if (!range) return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  const [report, status] = await Promise.all([
    loadHours(memberId, range.from, range.to),
    refreshStatus(memberId, pastWeeks(range.from, range.to)),
  ]);
  return NextResponse.json({
    ...report,
    refreshing: status.refreshing,
    refreshError: status.error,
  });
}

const pastWeeks = (from: string, to: string) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  return weekStarts(from, to).filter((week) => week <= today);
};

// «Обновить» забирает списания из портала заново: ночной сбор видит только вчерашний
// день, а ПМ жмёт кнопку, чтобы увидеть сегодняшние часы.
export async function POST(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const range = period(String(body.from || ''), String(body.to || ''));
  if (!range) return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });

  const weeks = pastWeeks(range.from, range.to);
  if (weeks.length > MAX_REFRESH_WEEKS)
    return NextResponse.json({ error: 'PERIOD_TOO_LONG' }, { status: 400 });
  // Сбор идёт в фоне, а признак «обновляется» лежит в базе: перезагрузка страницы его не
  // обрывает, и страница после неё снова показывает крутилку, пока сбор не кончится.
  // В мок-режиме портала нет: списания лежат в базе из сида.
  if (!isMockEnabled()) {
    await markRefreshing(memberId, weeks);
    after(async () => {
      for (const week of weeks) {
        const end = new Date(`${week}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 6);
        await refreshWorkloadTime(memberId, week, end.toISOString().slice(0, 10)).catch((error) =>
          console.error('[analytics-refresh]', week, error),
        );
      }
    });
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
