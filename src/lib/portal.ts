import { getDb } from '@/lib/mongo';

/**
 * Портал, к которому подключено приложение: его токен обслуживает фон (зеркало задач,
 * сбор часов, события). Портал один и защищённый: выбор не принимается ни из заголовка,
 * ни из запроса, иначе при втором портале в базе это стало бы IDOR.
 */
export async function getProtectedMemberId(): Promise<string | null> {
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
