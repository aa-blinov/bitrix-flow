import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { buildReport, REPORT_KINDS, type ReportKind } from '@/lib/pm-reports-data';
import type { StaleReason } from '@/lib/pm-reports';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const { kind } = await params;
  if (!REPORT_KINDS.includes(kind as ReportKind))
    return NextResponse.json({ error: 'UNKNOWN_REPORT' }, { status: 404 });
  const query = req.nextUrl.searchParams;
  const from = query.get('from') || '';
  const to = query.get('to') || '';
  if (!DAY.test(from) || !DAY.test(to) || from > to)
    return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  const days = Number(query.get('days'));
  const report = await buildReport(memberId, kind as ReportKind, {
    from,
    to,
    projectId: query.get('project') || null,
    idleDays: Number.isFinite(days) && days > 0 ? days : 14,
    reason: (query.get('reason') as StaleReason) || null,
  });
  return NextResponse.json(report);
}
