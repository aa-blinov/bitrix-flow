import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { cleanWidget, type Dashboard, type Widget } from '@/lib/dashboards';
import { getDb } from '@/lib/mongo';
import { sessionCookie } from '@/lib/session';

// Дашборды общие на портал, как вью задач: ПМ собирает экран один раз, и команда видит
// его же. Это настройка вида, а не сущность портала: в Битриксе ей места нет.
async function member(req: NextRequest) {
  return getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
}

const denied = () => NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

export async function GET(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return denied();
  const docs = await (
    await getDb()
  )
    .collection('dashboards')
    .find({ memberId })
    .sort({ createdAt: 1 })
    .toArray();
  return NextResponse.json({
    dashboards: docs.map((doc) => ({ id: doc.id, name: doc.name, widgets: doc.widgets || [] })),
  });
}

export async function PUT(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return denied();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  const name = String(body.name || '')
    .trim()
    .slice(0, 80);
  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 });
  const widgets: Widget[] = (Array.isArray(body.widgets) ? body.widgets : [])
    .slice(0, 40)
    .map(cleanWidget);
  const dashboard: Dashboard = { id: String(body.id || '') || randomUUID(), name, widgets };
  await (
    await getDb()
  )
    .collection('dashboards')
    .updateOne(
      { memberId, id: dashboard.id },
      { $set: { name, widgets, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  return NextResponse.json({ dashboard });
}

export async function DELETE(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return denied();
  const id = req.nextUrl.searchParams.get('id');
  if (id) await (await getDb()).collection('dashboards').deleteOne({ memberId, id });
  return new NextResponse(null, { status: 204 });
}
