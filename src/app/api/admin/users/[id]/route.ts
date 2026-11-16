import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin';
import {
  audit,
  countActiveAdmins,
  deleteUser,
  findUserById,
  updateUser,
  type Role,
} from '@/lib/users';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const error = (code: string, status: number) => NextResponse.json({ error: code }, { status });

// Последнего администратора лишать прав нельзя: иначе в админку никто не войдёт, и править
// придётся базу руками. Себя блокировать и удалять тоже нельзя по той же причине.
async function leavesNoAdmin(target: { role: Role; blocked: boolean }) {
  return target.role === 'admin' && !target.blocked && (await countActiveAdmins()) <= 1;
}

export function PATCH(req: NextRequest, { params }: Context) {
  return withAdmin(req, async (admin) => {
    const { id } = await params;
    const target = await findUserById(id);
    if (!target) return error('NOT_FOUND', 404);
    const body = await req.json().catch(() => null);
    const change: { blocked?: boolean; role?: Role } = {};
    if (typeof body?.blocked === 'boolean') change.blocked = body.blocked;
    if (body?.role === 'admin' || body?.role === 'user') change.role = body.role;
    const isSelf = String(target._id) === String(admin._id);
    if (isSelf && (change.blocked || change.role === 'user')) return error('SELF_LOCKOUT', 409);
    if ((change.blocked || change.role === 'user') && (await leavesNoAdmin(target)))
      return error('LAST_ADMIN', 409);
    if (!(await updateUser(id, change))) return error('NOTHING_TO_UPDATE', 400);
    await audit(
      admin.username,
      Object.entries(change)
        .map(([key, value]) => `${key}=${value}`)
        .join(','),
      target.username,
    );
    return NextResponse.json({ ok: true });
  });
}

export function DELETE(req: NextRequest, { params }: Context) {
  return withAdmin(req, async (admin) => {
    const { id } = await params;
    const target = await findUserById(id);
    if (!target) return error('NOT_FOUND', 404);
    if (String(target._id) === String(admin._id)) return error('SELF_LOCKOUT', 409);
    if (await leavesNoAdmin(target)) return error('LAST_ADMIN', 409);
    await deleteUser(id);
    await audit(admin.username, 'delete', target.username);
    return NextResponse.json({ ok: true });
  });
}
