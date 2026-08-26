import { getDb } from '@/lib/mongo';
import { hasActiveStoredSession } from '@/lib/session-store';

/**
 * This installation deliberately supports one protected portal.  The browser
 * must never be allowed to select an arbitrary OAuth record with a header or
 * query parameter: that would make it an IDOR as soon as a second portal is
 * present in the database.
 */
export async function getAuthorizedMemberId(session?: string): Promise<string | null> {
  if (!(await hasActiveStoredSession(session))) return null;
  const db = await getDb();
  const token = await db
    .collection('user_tokens')
    .find({ access_token: { $type: 'string', $ne: '' } })
    .sort({ updated_at: -1, installed_at: -1, _id: -1 })
    .limit(1)
    .next();
  return token?.member_id ? String(token.member_id) : null;
}
