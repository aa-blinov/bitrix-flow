import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin';
import { listUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

// Учётки создаются сами при входе через Битрикс: здесь только список для блокировки и ролей.
export function GET(req: NextRequest) {
  return withAdmin(req, async () => NextResponse.json({ users: await listUsers() }));
}
