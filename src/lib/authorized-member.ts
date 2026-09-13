import { getDb } from '@/lib/mongo';
import { hasActiveStoredSessionById } from '@/lib/session-store';
import { getSessionId } from '@/lib/session';

/**
 * This installation deliberately supports one protected portal.  The browser
 * must never be allowed to select an arbitrary OAuth record with a header or
 * query parameter: that would make it an IDOR as soon as a second portal is
 * present in the database.
 */
export async function getAuthorizedMemberId(session?: string): Promise<string | null> {
  // Подпись проверяется всегда, запись в sessions — тоже. Раньше запись
  // воссоздавалась на лету по живой куке: выход из системы переставал что-либо
  // отзывать, и украденная кука работала все восемь часов до истечения.
  const sessionId = await getSessionId(session);
  if (!sessionId) return null;
  const active = await hasActiveStoredSessionById(sessionId);
  if (!active) return null;
  const db = await getDb();
  const token = await db
    .collection('user_tokens')
    .find({
      access_token: { $type: 'string', $ne: '' },
      domain: { $type: 'string', $not: /^oauth\./ },
    })
    .sort({ updated_at: -1, installed_at: -1, _id: -1 })
    .limit(1)
    .next();
  return token?.member_id ? String(token.member_id) : null;
}
