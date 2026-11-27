// Токены MCP. Два вида в одной коллекции: личный токен для CLI и IDE (человек кладёт его в
// заголовок Authorization сам) и выдача OAuth для коннекторов claude.ai и ChatGPT, где заголовок
// вписать нельзя. Проверка у них общая, поэтому и отзыв, и блокировка действуют одинаково.
// В базе лежит только SHA-256: утечка коллекции не даёт войти, а сам токен виден один раз.
import { createHash, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo';
import { createSession } from './session';
import { createStoredSession, getSessionUser } from './session-store';
import { findUserById, type AppUser } from './users';

export const MCP_TOKEN_PREFIX = 'bf_';
// ponytail: лимит на человека, чтобы забытые токены не копились; поднять, если станет тесно.
const MAX_TOKENS_PER_USER = 10;
// Доступ OAuth короткий: украденный токен живёт час. Продление держит коннектор подключённым,
// пока им пользуются, и само исчезает через месяц простоя (TTL-индекс на refresh_expires_at).
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type McpToken = {
  _id: ObjectId;
  user_id: string;
  hash: string;
  name: string;
  created_at: Date;
  last_used_at?: Date;
  kind?: 'oauth';
  client_id?: string;
  expires_at?: Date;
  refresh_hash?: string;
  refresh_expires_at?: Date;
};

const secret = (prefix: string) => prefix + randomBytes(32).toString('base64url');

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

async function tokens() {
  return (await getDb()).collection<McpToken>('mcp_tokens');
}

export async function issueMcpToken(userId: string, name: string) {
  const collection = await tokens();
  if (
    (await collection.countDocuments({ user_id: userId, kind: { $ne: 'oauth' } })) >=
    MAX_TOKENS_PER_USER
  )
    return { error: 'TOO_MANY_TOKENS' as const };
  const token = secret(MCP_TOKEN_PREFIX);
  const _id = new ObjectId();
  await collection.insertOne({
    _id,
    user_id: userId,
    hash: tokenHash(token),
    name: name.trim().slice(0, 60) || 'MCP',
    created_at: new Date(),
  });
  return { id: String(_id), token };
}

export async function listMcpTokens(userId: string) {
  return (await (await tokens()).find({ user_id: userId }).sort({ created_at: -1 }).toArray()).map(
    (item) => ({
      id: String(item._id),
      name: item.name,
      createdAt: item.created_at.toISOString(),
      lastUsedAt: item.last_used_at?.toISOString() ?? null,
      oauth: item.kind === 'oauth',
    }),
  );
}

function oauthPair() {
  const access = secret(MCP_TOKEN_PREFIX);
  const refresh = secret('bfr_');
  const now = Date.now();
  return {
    access,
    refresh,
    fields: {
      hash: tokenHash(access),
      refresh_hash: tokenHash(refresh),
      expires_at: new Date(now + ACCESS_TTL_S * 1000),
      refresh_expires_at: new Date(now + REFRESH_TTL_MS),
    },
  };
}
const tokenResponse = (pair: ReturnType<typeof oauthPair>) => ({
  access_token: pair.access,
  token_type: 'Bearer',
  expires_in: ACCESS_TTL_S,
  refresh_token: pair.refresh,
  scope: 'mcp',
});

/** Выдача по коду OAuth. Повторное подключение того же клиента заменяет прежнюю выдачу. */
export async function issueOAuthGrant(userId: string, clientId: string, clientName: string) {
  const collection = await tokens();
  const pair = oauthPair();
  await collection.deleteMany({ user_id: userId, client_id: clientId });
  await collection.insertOne({
    _id: new ObjectId(),
    user_id: userId,
    name: clientName.slice(0, 60) || 'OAuth',
    created_at: new Date(),
    kind: 'oauth',
    client_id: clientId,
    ...pair.fields,
  });
  return tokenResponse(pair);
}

/** Продление с ротацией: старый refresh-токен после этого не принимается. */
export async function refreshOAuthGrant(refreshToken: string, clientId: string) {
  if (!refreshToken.startsWith('bfr_') || refreshToken.length > 200) return null;
  const pair = oauthPair();
  const updated = await (
    await tokens()
  ).findOneAndUpdate(
    {
      refresh_hash: tokenHash(refreshToken),
      client_id: clientId,
      refresh_expires_at: { $gt: new Date() },
    },
    { $set: pair.fields },
  );
  if (!updated) return null;
  const user = await findUserById(updated.user_id);
  return user && !user.blocked ? tokenResponse(pair) : null;
}

export async function revokeMcpToken(userId: string, id: string) {
  if (!ObjectId.isValid(id)) return false;
  const found = await (await tokens()).findOneAndDelete({ _id: new ObjectId(id), user_id: userId });
  if (found) sessions.delete(String(found._id));
  return Boolean(found);
}

/** Владелец токена, если токен жив и учётка не заблокирована. */
export async function userByMcpToken(
  token: string,
): Promise<{ user: AppUser; key: string } | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length > 200) return null;
  const hash = tokenHash(token);
  const collection = await tokens();
  const found = await collection.findOne({ hash });
  if (!found || (found.expires_at && found.expires_at.getTime() <= Date.now())) return null;
  const user = await findUserById(found.user_id);
  if (!user || user.blocked) return null;
  const seen = found.last_used_at?.getTime() ?? 0;
  if (Date.now() - seen > 60_000)
    void collection
      .updateOne({ _id: found._id }, { $set: { last_used_at: new Date() } })
      .catch(() => {});
  return { user, key: String(found._id) };
}

// Тулы зовут существующие роуты в процессе, а роуты знают только сессионную куку. Поэтому
// токену выдаётся обычная серверная сессия его владельца: проверки людей, портала и токена
// Битрикса проходят те же, что у браузера. Кука не покидает сервер, а блокировка или отзыв
// сессий удаляют запись, и следующий вызов увидит это через getSessionUser. Ключ это запись
// токена, а не его хеш: OAuth меняет токен каждый час, и сессия плодилась бы на каждую смену.
const sessions = new Map<string, string>();

export async function mcpSessionCookie(key: string, user: AppUser): Promise<string> {
  const cached = sessions.get(key);
  const alive = cached ? await getSessionUser(cached) : null;
  if (cached && alive && String(alive._id) === String(user._id)) return cached;
  const cookie = await createSession();
  await createStoredSession(cookie, 'mcp', String(user._id));
  sessions.set(key, cookie);
  return cookie;
}
