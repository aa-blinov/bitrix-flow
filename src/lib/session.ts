const SESSION_COOKIE = 'bitrix-kanban-session';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;

function toBase64Url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function sign(value: string): Promise<string> {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error('AUTH_SESSION_SECRET is not configured');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBytes = fromBase64Url(left);
  const rightBytes = fromBase64Url(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

export async function createSession(): Promise<string> {
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        sessionId: crypto.randomUUID(),
        expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000,
      }),
    ),
  );
  return `${payload}.${await sign(payload)}`;
}

export async function getSessionId(session: string | undefined): Promise<string | null> {
  if (!session) return null;
  const [payload, signature, ...rest] = session.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  try {
    if (!signaturesMatch(signature, await sign(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
      expiresAt?: number;
      sessionId?: unknown;
    };
    return typeof data.sessionId === 'string' &&
      data.sessionId.length > 0 &&
      data.expiresAt &&
      data.expiresAt > Date.now()
      ? data.sessionId
      : null;
  } catch {
    return null;
  }
}

export async function isValidSession(session: string | undefined): Promise<boolean> {
  return Boolean(await getSessionId(session));
}

export const sessionCookie = {
  name: SESSION_COOKIE,
  maxAge: SESSION_DURATION_SECONDS,
};
