import { beforeAll, describe, expect, it } from 'vitest';
import { createSession, getSessionId, isValidSession } from './session';

beforeAll(() => {
  process.env.AUTH_SESSION_SECRET = 'test-only-session-secret';
});

describe('signed browser session', () => {
  it('creates a signed session with a device-specific id', async () => {
    const first = await createSession();
    const second = await createSession();

    expect(await isValidSession(first)).toBe(true);
    expect(await getSessionId(first)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getSessionId(first)).not.toBe(await getSessionId(second));
  });

  it('rejects a tampered session', async () => {
    const session = await createSession();
    const [payload, signature] = session.split('.');
    // Appending a Base64URL character to the signed payload always changes the
    // HMAC input; mutating a trailing signature character is not deterministic
    // because unused Base64 bits can decode to the same byte sequence.
    const tampered = `${payload}a.${signature}`;

    expect(await isValidSession(tampered)).toBe(false);
  });
});
