import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin';
import {
  audit,
  createUser,
  listUsers,
  normalizeUsername,
  passwordProblem,
  validUsername,
  type Role,
} from '@/lib/users';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withAdmin(req, async () => NextResponse.json({ users: await listUsers() }));
}

export function POST(req: NextRequest) {
  return withAdmin(req, async (admin) => {
    const body = await req.json().catch(() => null);
    const username = normalizeUsername(body?.username);
    const role: Role = body?.role === 'admin' ? 'admin' : 'user';
    if (!validUsername(username))
      return NextResponse.json({ error: 'BAD_USERNAME' }, { status: 400 });
    const problem = passwordProblem(body?.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const user = await createUser(username, body.password, role);
    if (!user) return NextResponse.json({ error: 'USERNAME_TAKEN' }, { status: 409 });
    await audit(admin.username, `create:${role}`, username);
    return NextResponse.json({ user }, { status: 201 });
  });
}
