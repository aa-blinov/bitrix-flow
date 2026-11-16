// Личные учётные записи приложения. Доступ к порталу Битрикса остаётся у сервера (один
// защищённый портал, токен не покидает сервер), а людям выдаются свои логины: заблокировать
// или удалить одного человека, не меняя общий пароль для всех остальных.
import { ObjectId } from 'mongodb';
import { getDb } from './mongo';
import { hashPassword } from './password';

export type Role = 'admin' | 'user';

export type AppUser = {
  _id: ObjectId;
  username: string;
  password_hash: string;
  role: Role;
  blocked: boolean;
  created_at: Date;
  last_login_at?: Date;
  /** Привязка к пользователю Битрикса: от его имени идут записи и мессенджер. */
  bitrix_member_id?: string;
  bitrix_user_id?: string;
  /** Имя из Битрикса, для списка учётных записей. */
  display_name?: string;
};

export type PublicUser = {
  id: string;
  username: string;
  role: Role;
  blocked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  bitrixUserId: string | null;
  displayName: string | null;
};

export const normalizeUsername = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const toPublic = (user: AppUser): PublicUser => ({
  id: String(user._id),
  username: user.username,
  role: user.role,
  blocked: user.blocked,
  createdAt: user.created_at.toISOString(),
  lastLoginAt: user.last_login_at ? user.last_login_at.toISOString() : null,
  bitrixUserId: user.bitrix_user_id || null,
  displayName: user.display_name || null,
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

export async function countActiveAdmins() {
  return (await users()).countDocuments({ role: 'admin', blocked: false });
}

export async function updateUser(id: string, change: { blocked?: boolean; role?: Role }) {
  const set: Partial<AppUser> = {};
  if (change.blocked !== undefined) set.blocked = change.blocked;
  if (change.role) set.role = change.role;
  if (!Object.keys(set).length || !ObjectId.isValid(id)) return false;
  const result = await (await users()).updateOne({ _id: new ObjectId(id) }, { $set: set });
  // Блокировка и понижение роли действуют сразу: открытые сессии закрываются.
  if (result.matchedCount && (change.blocked || change.role === 'user'))
    await revokeUserSessions(id);
  return result.matchedCount > 0;
}

export async function deleteUser(id: string) {
  if (!ObjectId.isValid(id)) return false;
  const user = await (await users()).findOne({ _id: new ObjectId(id) });
  const result = await (await users()).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount) {
    await revokeUserSessions(id);
    // Вместе с учёткой уходит и доступ в портал от имени человека: его токен и устройства.
    if (user?.bitrix_user_id) {
      const db = await getDb();
      const person = { member_id: user.bitrix_member_id, user_id: user.bitrix_user_id };
      await db.collection('person_tokens').deleteMany(person);
      await db.collection('push_subscriptions').deleteMany(person);
    }
  }
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

/**
 * Учётка для входа через Битрикс. Порядок: уже привязанная к этому человеку; учётка, под
 * которой сейчас вошли паролем (привязка из профиля); для владельца токена портала его
 * прежняя админская учётка, чтобы не потерять права; иначе новая с ролью user. Кого вообще
 * пускать, решают права приложения в самом Битриксе: OAuth пройдёт только тот, кому портал
 * дал доступ к приложению, а заблокировать человека можно здесь же, в учётных записях.
 */
export async function accountForBitrix(input: {
  memberId: string;
  userId: string;
  name: string;
  portalOwner: boolean;
  current: AppUser | null;
}): Promise<AppUser | { error: 'ALREADY_LINKED' }> {
  const collection = await users();
  const link = { bitrix_member_id: input.memberId, bitrix_user_id: input.userId };
  const linked = await collection.findOne(link);
  if (input.current && !input.current.bitrix_user_id) {
    if (linked && String(linked._id) !== String(input.current._id))
      return { error: 'ALREADY_LINKED' };
    await collection.updateOne(
      { _id: input.current._id },
      { $set: { ...link, display_name: input.name } },
    );
    return { ...input.current, ...link, display_name: input.name };
  }
  if (linked) {
    await collection.updateOne({ _id: linked._id }, { $set: { display_name: input.name } });
    return { ...linked, display_name: input.name };
  }
  if (input.portalOwner) {
    const admin = await collection.findOne(
      { role: 'admin', bitrix_user_id: { $exists: false } },
      { sort: { created_at: 1 } },
    );
    if (admin) {
      await collection.updateOne(
        { _id: admin._id },
        { $set: { ...link, display_name: input.name } },
      );
      return { ...admin, ...link, display_name: input.name };
    }
  }
  const user: AppUser = {
    _id: new ObjectId(),
    username: `b24-${input.userId}`,
    // Пароля нет: такая учётка входит только через Битрикс.
    password_hash: '',
    role: input.portalOwner ? 'admin' : 'user',
    blocked: false,
    created_at: new Date(),
    ...link,
    display_name: input.name,
  };
  await collection.insertOne(user);
  return user;
}
