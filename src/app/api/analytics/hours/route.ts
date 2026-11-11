import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { loadHours, weekStarts } from '@/lib/hours';
import { isMockEnabled } from '@/lib/mock-b24';
import { sessionCookie } from '@/lib/session';
import { refreshWorkloadTime } from '@/lib/workload-time';

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
  return NextResponse.json(await loadHours(memberId, range.from, range.to));
}

// «Обновить» забирает списания из портала заново: ночной сбор видит только вчерашний
// день, а ПМ жмёт кнопку, чтобы увидеть сегодняшние часы.
export async function POST(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const range = period(String(body.from || ''), String(body.to || ''));
  if (!range) return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const weeks = weekStarts(range.from, range.to).filter((week) => week <= today);
  if (weeks.length > MAX_REFRESH_WEEKS)
    return NextResponse.json({ error: 'PERIOD_TOO_LONG' }, { status: 400 });
  // В мок-режиме портала нет: списания лежат в базе из сида.
  if (!isMockEnabled()) {
    try {
      for (const week of weeks) {
        const end = new Date(`${week}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 6);
        await refreshWorkloadTime(memberId, week, end.toISOString().slice(0, 10));
      }
    } catch (error) {
      return NextResponse.json(
        { error: 'BITRIX_ERROR', message: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  }
  return NextResponse.json(await loadHours(memberId, range.from, range.to));
}
