// Личные учётные записи приложения. Доступ к порталу Битрикса остаётся у сервера (один
// защищённый портал, токен не покидает сервер), а людям выдаются свои логины: заблокировать
// или удалить одного человека, не меняя общий пароль для всех остальных.
import { ObjectId } from 'mongodb';
import { getDb } from './mongo';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword } from './password';

export type Role = 'admin' | 'user';

export type AppUser = {
  _id: ObjectId;
  username: string;
  password_hash: string;
  role: Role;
  blocked: boolean;
  created_at: Date;
  last_login_at?: Date;
};

export type PublicUser = {
  id: string;
  username: string;
  role: Role;
  blocked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

const USERNAME = /^[a-z0-9][a-z0-9._@-]{1,63}$/;

export const normalizeUsername = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const validUsername = (value: string) => USERNAME.test(value);

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'BAD_PASSWORD';
  if (password.length < MIN_PASSWORD_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (password.length > MAX_PASSWORD_LENGTH) return 'BAD_PASSWORD';
  return null;
}

export const toPublic = (user: AppUser): PublicUser => ({
  id: String(user._id),
  username: user.username,
  role: user.role,
  blocked: user.blocked,
  createdAt: user.created_at.toISOString(),
  lastLoginAt: user.last_login_at ? user.last_login_at.toISOString() : null,
});

async function users() {
  const collection = (await getDb()).collection<AppUser>('app_users');
  await collection.createIndex({ username: 1 }, { unique: true }).catch(() => {});
  return collection;
}

export async function findUserByName(username: string) {
  return (await users()).findOne({ username });
}

export async function findUserById(id: string) {
  return ObjectId.isValid(id) ? (await users()).findOne({ _id: new ObjectId(id) }) : null;
}

export async function listUsers() {
  return (await (await users()).find().sort({ created_at: 1 }).toArray()).map(toPublic);
}

/**
 * Первый запуск: пока записей нет, администратор берётся из AUTH_USERNAME и AUTH_PASSWORD.
 * Дальше эти переменные вход не определяют: пароль меняется в админке, а не в окружении.
 */
export async function bootstrapAdmin() {
  const collection = await users();
  if (await collection.estimatedDocumentCount()) return;
  const username = normalizeUsername(process.env.AUTH_USERNAME);
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) return;
  await collection
    .insertOne({
      _id: new ObjectId(),
      username,
      password_hash: await hashPassword(password),
      role: 'admin',
      blocked: false,
      created_at: new Date(),
    })
    .catch(() => {});
}

export async function createUser(username: string, password: string, role: Role) {
  const collection = await users();
  const user: AppUser = {
    _id: new ObjectId(),
    username,
    password_hash: await hashPassword(password),
    role,
    blocked: false,
    created_at: new Date(),
  };
  try {
    await collection.insertOne(user);
  } catch {
    return null;
  }
  return toPublic(user);
}

export async function countActiveAdmins() {
  return (await users()).countDocuments({ role: 'admin', blocked: false });
}

export async function updateUser(
  id: string,
  change: { blocked?: boolean; role?: Role; password?: string },
) {
  const set: Partial<AppUser> = {};
  if (change.blocked !== undefined) set.blocked = change.blocked;
  if (change.role) set.role = change.role;
  if (change.password) set.password_hash = await hashPassword(change.password);
  if (!Object.keys(set).length || !ObjectId.isValid(id)) return false;
  const result = await (await users()).updateOne({ _id: new ObjectId(id) }, { $set: set });
  // Блокировка, смена пароля и понижение роли действуют сразу: открытые сессии закрываются.
  if (result.matchedCount && (change.blocked || change.password || change.role === 'user'))
    await revokeUserSessions(id);
  return result.matchedCount > 0;
}

export async function deleteUser(id: string) {
  if (!ObjectId.isValid(id)) return false;
  const result = await (await users()).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount) await revokeUserSessions(id);
  return result.deletedCount > 0;
}

export async function revokeUserSessions(id: string) {
  await (await getDb()).collection('sessions').deleteMany({ user_id: id });
}

export async function markLogin(id: ObjectId) {
  await (await users()).updateOne({ _id: id }, { $set: { last_login_at: new Date() } });
}

export async function audit(actor: string, action: string, target: string) {
  await (
    await getDb()
  )
    .collection('audit_log')
    .insertOne({ actor, action, target, at: new Date() })
    .catch(() => {});
  console.info('[audit]', actor, action, target);
}
