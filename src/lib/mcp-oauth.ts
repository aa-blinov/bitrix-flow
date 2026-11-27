// Сервер авторизации OAuth 2.1 для MCP. Коннекторы claude.ai и ChatGPT не дают вписать заголовок,
// они находят сервер через /.well-known, регистрируются сами (RFC 7591) и проводят человека через
// согласие. Вход человека остаётся прежним, через Битрикс: OAuth только выдаёт токен MCP тому,
// кто уже вошёл и сам нажал «Разрешить».
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from './mongo';
import { tokenHash } from './mcp-tokens';

// Адреса берутся из BITRIX24_APP_URL, а не из Host: подменённый Host выдал бы клиенту чужой
// сервер авторизации, и код со всем доступом ушёл бы туда.
export const appOrigin = () => (process.env.BITRIX24_APP_URL || '').replace(/\/$/, '');
export const mcpResource = () => `${appOrigin()}/api/mcp`;
export const resourceMetadataUrl = () => `${appOrigin()}/.well-known/oauth-protected-resource`;

const CLIENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;

export type OAuthClient = {
  client_id: string;
  secret_hash?: string;
  client_name: string;
  redirect_uris: string[];
  created_at: Date;
  expires_at: Date;
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
// Адрес возврата открывается из страницы согласия, поэтому схемы, которые исполняют код или
// читают локальное, запрещены. Свои схемы нативных клиентов (cursor://, vscode://) разрешены.
const FORBIDDEN_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'blob:',
  'about:',
  'filesystem:',
  'ws:',
  'wss:',
]);

export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !FORBIDDEN_SCHEMES.has(url.protocol);
}

// RFC 8252: нативный клиент слушает петлевой адрес на случайном порту, поэтому порт не сверяем.
export function redirectMatches(registered: string[], asked: string) {
  if (registered.includes(asked)) return true;
  try {
    const url = new URL(asked);
    if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) return false;
    return registered.some((item) => {
      const known = new URL(item);
      return (
        known.protocol === 'http:' &&
        known.hostname === url.hostname &&
        known.pathname === url.pathname &&
        known.search === url.search
      );
    });
  } catch {
    return false;
  }
}

export function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const expected = createHash('sha256').update(verifier).digest('base64url');
  return (
    expected.length === challenge.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(challenge))
  );
}

// Клиент вправе прислать ресурс как адрес MCP или как корень приложения: claude.ai шлёт первое,
// часть клиентов второе. Чужой ресурс отклоняем, токен для другого сервера нам не выдавать.
export const validResource = (value: string | null | undefined) =>
  !value || [mcpResource(), appOrigin(), `${appOrigin()}/`].includes(value);

async function clients() {
  return (await getDb()).collection<OAuthClient>('oauth_clients');
}

export async function registerClient(input: {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
}) {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirectUri))
    return { error: 'invalid_redirect_uri' as const };
  const method = input.token_endpoint_auth_method || 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(String(method)))
    return { error: 'invalid_client_metadata' as const };
  const clientId = `bfc_${randomBytes(16).toString('base64url')}`;
  const clientSecret = method === 'none' ? undefined : randomBytes(32).toString('base64url');
  const now = new Date();
  const client: OAuthClient = {
    client_id: clientId,
    client_name: String(input.client_name || '').slice(0, 80) || 'MCP client',
    redirect_uris: uris,
    created_at: now,
    expires_at: new Date(now.getTime() + CLIENT_TTL_MS),
    ...(clientSecret ? { secret_hash: tokenHash(clientSecret) } : {}),
  };
  await (await clients()).insertOne(client);
  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: client.client_name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
  };
}

export async function findClient(clientId: unknown) {
  if (typeof clientId !== 'string' || !/^bfc_[\w-]{10,40}$/.test(clientId)) return null;
  return (await clients()).findOne({ client_id: clientId });
}

/** Клиент с секретом обязан его предъявить. Публичный клиент защищён PKCE. */
export function clientAuthenticated(client: OAuthClient, secret: string | null) {
  if (!client.secret_hash) return true;
  if (!secret) return false;
  const left = Buffer.from(tokenHash(secret));
  const right = Buffer.from(client.secret_hash);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Пока клиентом пользуются, он не истекает: TTL убирает только брошенные регистрации.
export async function touchClient(clientId: string) {
  await (
    await clients()
  ).updateOne(
    { client_id: clientId },
    { $set: { expires_at: new Date(Date.now() + CLIENT_TTL_MS) } },
  );
}

type CodeRecord = {
  hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: Date;
};

export async function createCode(input: Omit<CodeRecord, 'hash' | 'expires_at'>) {
  const code = randomBytes(32).toString('base64url');
  await (await getDb()).collection<CodeRecord>('oauth_codes').insertOne({
    ...input,
    hash: tokenHash(code),
    expires_at: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

/** Код одноразовый: удаляется при первом предъявлении, даже если дальше проверка не пройдёт. */
export async function consumeCode(code: string) {
  if (!code || code.length > 200) return null;
  const found = await (
    await getDb()
  )
    .collection<CodeRecord>('oauth_codes')
    .findOneAndDelete({ hash: tokenHash(code) });
  return found && found.expires_at.getTime() > Date.now() ? found : null;
}
