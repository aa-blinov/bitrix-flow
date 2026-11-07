import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { isHourClass } from '@/lib/hour-class';
import { getDb } from '@/lib/mongo';
import { sessionCookie } from '@/lib/session';
import { audit } from '@/lib/users';

export const dynamic = 'force-dynamic';

// Класс проекта по умолчанию: без него почти все часы падают в «нераспределено»,
// потому что классовых тегов на задачах портала пока нет. Ставит только админ,
// так как класс решает, какие часы считаются выручкой.
export async function PUT(req: NextRequest) {
  return withAdmin(req, async (admin) => {
    const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
    if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const projectId = String(body?.projectId ?? '');
    const hourClass = body?.hourClass;
    if (!/^\d+$/.test(projectId) || (hourClass !== null && !isHourClass(hourClass))) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const db = await getDb();
    const filter = { member_id: memberId, project_id: projectId };
    if (hourClass === null) await db.collection('project_hour_class').deleteOne(filter);
    else
      await db
        .collection('project_hour_class')
        .updateOne(
          filter,
          { $set: { hour_class: hourClass, updated_at: new Date() } },
          { upsert: true },
        );
    await audit(admin.username, 'project_hour_class', `${projectId}:${hourClass ?? '-'}`);
    return NextResponse.json({ ok: true });
  });
}
