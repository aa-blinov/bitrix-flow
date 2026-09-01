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

function normalizeScope(value: unknown): string {
  if (value === 'all' || value === 'my') return value;
  return typeof value === 'string' && /^project:\d+$/.test(value) ? value : 'all';
}

export async function GET(request: NextRequest) {
  const member = await memberId(request);
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const scope = normalizeScope(request.nextUrl.searchParams.get('scope'));
  const preferences = (await getDb()).collection('task_grid_preferences');
  let preference = await preferences.findOne({ memberId: member, scope });
  // Migrate the single global layout created before layouts gained scopes.
  if (!preference && scope === 'all') {
    preference = await preferences.findOne({ memberId: member, scope: { $exists: false } });
    if (preference) await preferences.updateOne({ _id: preference._id }, { $set: { scope } });
  }
  return NextResponse.json({ preference: preference?.config || null });
}

export async function PUT(request: NextRequest) {
  const member = await memberId(request);
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const scope = normalizeScope(body?.scope);
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
  await (await getDb()).collection('task_grid_preferences').updateOne(
    { memberId: member, scope },
    {
      $set: { config: savedConfig, updatedAt: new Date() },
      $setOnInsert: { memberId: member, scope },
    },
    { upsert: true },
  );
  return NextResponse.json({ preference: savedConfig });
}
