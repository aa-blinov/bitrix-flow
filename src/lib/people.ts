// Люди, а не портал. Токен портала (user_tokens) обслуживает фон: зеркало задач, сбор часов,
// события задач. Всё, что человек делает руками (пишет, правит, читает свои чаты), идёт его
// собственным токеном: иначе любой вошедший действовал бы в Битриксе от имени владельца
// токена портала и видел бы его личную переписку.
import { getDb } from './mongo';
import { getProtectedMemberId } from './portal';
import { isMockEnabled } from './mock-b24';
import { getSessionUser } from './session-store';
import type { AppUser } from './users';

export type Person = { memberId: string; userId: string; user: AppUser };

export type PersonToken = {
  member_id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  domain: string;
  updated_at: Date;
};

// Индекс создаём один раз за жизнь процесса: personTokens стоит за каждым API-запросом.
let indexed: Promise<unknown> | null = null;
export async function personTokens() {
  const collection = (await getDb()).collection<PersonToken>('person_tokens');
  indexed ??= collection.createIndex({ member_id: 1, user_id: 1 }, { unique: true }).catch(() => {
    indexed = null;
  });
  await indexed;
  return collection;
}

export async function savePersonToken(token: Omit<PersonToken, 'updated_at'>) {
  await (
    await personTokens()
  ).updateOne(
    { member_id: token.member_id, user_id: token.user_id },
    { $set: { ...token, updated_at: new Date() } },
    { upsert: true },
  );
}

export async function findPersonToken(memberId: string, userId: string) {
  return (await personTokens()).findOne({ member_id: memberId, user_id: userId });
}

// В UI-тестах портала нет: любой вошедший считается пользователем 1 тестового портала.
const MOCK_USER_ID = '1';

/**
 * Кто действует в этом запросе. null, если вход не выполнен, учётка не привязана к Битриксу,
 * привязана к другому порталу или у человека нет живого токена: тогда данные закрыты
 * целиком, а не отдаются через токен портала.
 */
export async function getSessionPerson(cookie: string | undefined): Promise<Person | null> {
  const user = await getSessionUser(cookie);
  if (!user) return null;
  const memberId = await getProtectedMemberId();
  if (!memberId) return null;
  if (isMockEnabled()) return { memberId, userId: MOCK_USER_ID, user };
  if (!user.bitrix_user_id || user.bitrix_member_id !== memberId) return null;
  const token = await findPersonToken(memberId, user.bitrix_user_id);
  return token?.access_token ? { memberId, userId: user.bitrix_user_id, user } : null;
}
