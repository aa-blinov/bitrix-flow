import { createHash } from 'node:crypto';
import { getDb } from '@/lib/mongo';
import { getSessionId } from '@/lib/session';
import { findUserById, type AppUser } from '@/lib/users';

function sessionHash(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('hex');
}

export async function createStoredSession(
  cookie: string,
  userAgent: string | null,
  userId: string,
) {
  const sessionId = await getSessionId(cookie);
  if (!sessionId) throw new Error('Invalid session payload');
  const now = new Date();
  await (await getDb()).collection('sessions').insertOne({
    session_hash: sessionHash(sessionId),
    user_id: userId,
    created_at: now,
    last_seen_at: now,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
    // This is diagnostic metadata only; do not create a browser fingerprint.
    user_agent: (userAgent || '').slice(0, 300),
  });
}

// Сессия живёт, пока жива запись в sessions и учётная запись не заблокирована и не удалена.
// Проверка при каждом запросе: блокировка должна действовать сразу, а не через восемь часов.
// Сессии без user_id остались от входа общим паролем и больше не принимаются.
export async function getActiveSessionUser(sessionId: string): Promise<AppUser | null> {
  const db = await getDb();
  const found = await db
    .collection('sessions')
    .findOneAndUpdate(
      { session_hash: sessionHash(sessionId), expiresAt: { $gt: new Date() } },
      { $set: { last_seen_at: new Date() } },
      { returnDocument: 'after' },
    );
  if (!found?.user_id) return null;
  const user = await findUserById(String(found.user_id));
  return user && !user.blocked ? user : null;
}

export async function hasActiveStoredSessionById(sessionId: string): Promise<boolean> {
  return Boolean(await getActiveSessionUser(sessionId));
}

export async function getSessionUser(cookie: string | undefined): Promise<AppUser | null> {
  const sessionId = await getSessionId(cookie);
  return sessionId ? getActiveSessionUser(sessionId) : null;
}

export async function revokeStoredSession(cookie: string | undefined) {
  const sessionId = await getSessionId(cookie);
  if (sessionId)
    await (
      await getDb()
    )
      .collection('sessions')
      .deleteOne({ session_hash: sessionHash(sessionId) });
}
