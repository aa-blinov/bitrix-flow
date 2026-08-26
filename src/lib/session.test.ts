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
    const tampered = `${session.slice(0, -1)}${session.endsWith('a') ? 'b' : 'a'}`;

    expect(await isValidSession(tampered)).toBe(false);
  });
});
