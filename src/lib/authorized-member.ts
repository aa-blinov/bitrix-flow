import { getSessionPerson, type Person } from '@/lib/people';

export { getProtectedMemberId } from '@/lib/portal';

/**
 * Портал вошедшего человека, если его учётка привязана к Битриксу этого портала.
 * Без привязки null: данные закрыты целиком, как решено для входа через Битрикс,
 * а не отдаются через токен портала от имени его владельца.
 */
export async function getAuthorizedMemberId(session?: string): Promise<string | null> {
  return (await getSessionPerson(session))?.memberId ?? null;
}

/** Кто действует: портал и пользователь Битрикса. Записи и мессенджер идут его токеном. */
export async function getAuthorizedPerson(session?: string): Promise<Person | null> {
  return getSessionPerson(session);
}
