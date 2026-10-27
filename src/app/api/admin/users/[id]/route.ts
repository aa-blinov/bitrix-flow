import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin';
import {
  audit,
  countActiveAdmins,
  deleteUser,
  findUserById,
  passwordProblem,
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
    const change: { blocked?: boolean; role?: Role; password?: string } = {};
    if (typeof body?.blocked === 'boolean') change.blocked = body.blocked;
    if (body?.role === 'admin' || body?.role === 'user') change.role = body.role;
    if (body?.password !== undefined) {
      const problem = passwordProblem(body.password);
      if (problem) return error(problem, 400);
      change.password = body.password;
    }
    const isSelf = String(target._id) === String(admin._id);
    if (isSelf && (change.blocked || change.role === 'user')) return error('SELF_LOCKOUT', 409);
    if ((change.blocked || change.role === 'user') && (await leavesNoAdmin(target)))
      return error('LAST_ADMIN', 409);
    if (!(await updateUser(id, change))) return error('NOTHING_TO_UPDATE', 400);
    await audit(
      admin.username,
      Object.keys(change)
        .map((key) => (key === 'password' ? 'password' : `${key}=${(change as any)[key]}`))
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
