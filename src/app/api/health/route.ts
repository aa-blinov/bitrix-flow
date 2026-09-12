// Проверка живости для docker/мониторинга: приложение отвечает и видит Mongo.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return NextResponse.json({ status: 'ok', mongo: 'up' });
  } catch (error) {
    return NextResponse.json(
      { status: 'degraded', mongo: 'down', error: error instanceof Error ? error.message : '' },
      { status: 503 },
    );
  }
}
