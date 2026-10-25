// Проверка живости для docker/мониторинга: приложение отвечает и видит Mongo.
// Состояние поллеров идёт отдельным полем warnings (см. src/lib/health.ts).
import { NextResponse } from 'next/server';
import { getSyncHealth } from '@/lib/background-sync';
import { pollerWarnings } from '@/lib/health';
import { getMessengerEventsHealth } from '@/lib/messenger-events';
import { getDb } from '@/lib/mongo';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    // В mock-режиме портала нет и поллеры не запускаются.
    const warnings =
      process.env.MOCK_B24 === '1'
        ? []
        : pollerWarnings({
            tasks: getSyncHealth(),
            chat: getMessengerEventsHealth(),
            now: Date.now(),
            uptimeSeconds: process.uptime(),
          });
    return NextResponse.json({ status: 'ok', mongo: 'up', warnings });
  } catch (error) {
    return NextResponse.json(
      { status: 'degraded', mongo: 'down', error: error instanceof Error ? error.message : '' },
      { status: 503 },
    );
  }
}
