import { createHash } from 'node:crypto';
import { getDb } from '@/lib/mongo';
import { getSessionId } from '@/lib/session';

function sessionHash(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('hex');
}

export async function createStoredSession(cookie: string, userAgent: string | null) {
  const sessionId = await getSessionId(cookie);
  if (!sessionId) throw new Error('Invalid session payload');
  const now = new Date();
  await (await getDb()).collection('sessions').insertOne({
    session_hash: sessionHash(sessionId),
    created_at: now,
    last_seen_at: now,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
    // This is diagnostic metadata only; do not create a browser fingerprint.
    user_agent: (userAgent || '').slice(0, 300),
  });
}

export async function hasActiveStoredSession(cookie: string | undefined): Promise<boolean> {
  const sessionId = await getSessionId(cookie);
  if (!sessionId) return false;
  const db = await getDb();
  const found = await db
    .collection('sessions')
    .findOneAndUpdate(
      { session_hash: sessionHash(sessionId), expiresAt: { $gt: new Date() } },
      { $set: { last_seen_at: new Date() } },
      { returnDocument: 'after' },
    );
  return Boolean(found);
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
