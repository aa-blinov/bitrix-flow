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

const toDashboard = (doc: Record<string, unknown>): Dashboard => ({
  id: String(doc.id),
  name: String(doc.name),
  description: String(doc.description || ''),
  widgets: (doc.widgets as Widget[]) || [],
  version: Number(doc.version) || 0,
});

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
    dashboards: docs.map(toDashboard),
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
  const description = String(body.description || '')
    .trim()
    .slice(0, 300);
  const id = String(body.id || '').slice(0, 64) || randomUUID();
  const version = Number(body.version) || 0;
  const collection = (await getDb()).collection('dashboards');
  const now = new Date();
  if (!(await collection.findOne({ memberId, id }, { projection: { _id: 1 } }))) {
    await collection.insertOne({
      memberId,
      id,
      name,
      description,
      widgets,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ dashboard: { id, name, description, widgets, version: 1 } });
  }
  // Дашборд общий: правка идёт поверх той версии, которую видел автор. Иначе второй
  // сохранивший молча стирает виджеты первого.
  const { matchedCount } = await collection.updateOne(
    { memberId, id, version: version || { $in: [0, null] } },
    { $set: { name, description, widgets, updatedAt: now }, $inc: { version: 1 } },
  );
  if (!matchedCount) {
    const current = await collection.findOne({ memberId, id });
    return NextResponse.json(
      { error: 'CONFLICT', dashboard: current ? toDashboard(current) : null },
      { status: 409 },
    );
  }
  return NextResponse.json({ dashboard: { id, name, description, widgets, version: version + 1 } });
}

export async function DELETE(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return denied();
  const id = req.nextUrl.searchParams.get('id');
  if (id) await (await getDb()).collection('dashboards').deleteOne({ memberId, id });
  return new NextResponse(null, { status: 204 });
}
