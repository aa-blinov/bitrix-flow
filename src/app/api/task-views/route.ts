import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { getDb } from '@/lib/mongo';

async function member(req: NextRequest) {
  return getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
}

export async function GET(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const scope = req.nextUrl.searchParams.get('scope') || 'all';
  const db = await getDb();
  const views = await db.collection('task_views').find({ memberId, scope }).sort({ name: 1 }).toArray();
  return NextResponse.json({ views: views.map(({ _id, memberId: _, ...view }) => view) });
}

export async function POST(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const body = await req.json();
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 });
  const view = { id: randomUUID(), memberId, scope: body.scope === 'my' ? 'my' : 'all', name, config: body.config, createdAt: new Date(), updatedAt: new Date() };
  await (await getDb()).collection('task_views').insertOne(view);
  return NextResponse.json({ view: { ...view, memberId: undefined } });
}

export async function DELETE(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (id) await (await getDb()).collection('task_views').deleteOne({ id, memberId });
  return new NextResponse(null, { status: 204 });
}
