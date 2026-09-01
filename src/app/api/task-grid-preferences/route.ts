import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { getDb } from '@/lib/mongo';

const COLUMN_KEYS = new Set([
  'title',
  'project',
  'stage',
  'assignee',
  'priority',
  'deadline',
  'estimate',
  'actual',
  'updated',
  'description',
  'created',
  'comments',
  'parent',
  'storyPoints',
  'tags',
]);

async function memberId(request: NextRequest) {
  return getAuthorizedMemberId(request.cookies.get(sessionCookie.name)?.value);
}

export async function GET(request: NextRequest) {
  const member = await memberId(request);
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const preference = await (
    await getDb()
  )
    .collection('task_grid_preferences')
    .findOne({ memberId: member });
  return NextResponse.json({ preference: preference?.config || null });
}

export async function PUT(request: NextRequest) {
  const member = await memberId(request);
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const config = body?.config;
  const visibleColumns = Array.isArray(config?.visibleColumns)
    ? [
        ...new Set(
          config.visibleColumns.filter(
            (column: unknown) => typeof column === 'string' && COLUMN_KEYS.has(column),
          ),
        ),
      ]
    : [];
  if (!visibleColumns.includes('title')) visibleColumns.unshift('title');
  if (visibleColumns.length === 0)
    return NextResponse.json({ error: 'INVALID_COLUMNS' }, { status: 400 });

  const columnWidths: Record<string, number> = {};
  if (config?.columnWidths && typeof config.columnWidths === 'object') {
    for (const [column, width] of Object.entries(config.columnWidths)) {
      if (COLUMN_KEYS.has(column) && typeof width === 'number' && Number.isFinite(width)) {
        columnWidths[column] = Math.min(800, Math.max(80, Math.round(width)));
      }
    }
  }

  const savedConfig = { visibleColumns, columnWidths };
  await (
    await getDb()
  )
    .collection('task_grid_preferences')
    .updateOne(
      { memberId: member },
      { $set: { config: savedConfig, updatedAt: new Date() }, $setOnInsert: { memberId: member } },
      { upsert: true },
    );
  return NextResponse.json({ preference: savedConfig });
}
