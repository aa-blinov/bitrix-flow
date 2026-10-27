import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt из node:crypto: отдельная зависимость ради хеша паролей не нужна.
const KEY_LENGTH = 64;
const COST = 16384;

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { N: COST }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${COST}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Заглушка для несуществующего логина: проверка занимает столько же времени, и по скорости
// ответа нельзя отличить «нет такой учётной записи» от «неверный пароль».
const DUMMY = hashPassword('dummy-password-for-timing');

export async function verifyPassword(password: string, stored: string | undefined) {
  const [scheme, cost, salt, hash] = (stored || (await DUMMY)).split('$');
  if (scheme !== 'scrypt' || Number(cost) !== COST) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'));
  return (
    stored !== undefined && expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

// Пароль без неоднозначных символов (0/O, 1/l), чтобы его можно было прочитать вслух.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(length = 16): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}
