import { afterEach, describe, expect, it, vi } from 'vitest';

let stored = {
  access_token: 'old',
  refresh_token: 'r1',
  expires_in: 3600,
  domain: 'p.bitrix24.ru',
};
const collection = {
  findOne: vi.fn(async () => ({ ...stored })),
  updateOne: vi.fn(async (_filter: unknown, update: { $set: typeof stored }) => {
    stored = { ...stored, ...update.$set };
  }),
};
vi.mock('./mongo', () => ({ getDb: async () => ({ collection: () => collection }) }));
// Портал отвечает expired_token на старый токен и данными на новый.
vi.mock('./bitrix-request', () => ({
  postBitrixJson: async (url: string) =>
    url.includes('auth=old') ? { error: 'expired_token' } : { result: 'ok' },
}));

afterEach(() => vi.unstubAllGlobals());

describe('bx24OAuth', () => {
  it('параллельные запросы с протухшим токеном обновляют его один раз', async () => {
    const oauth = vi.fn(async () => {
      // Повтор того же refresh_token портал отклоняет: второй вызов уронил бы запрос.
      if (oauth.mock.calls.length > 1) return Response.json({ error: 'invalid_grant' });
      return Response.json({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 });
    });
    vi.stubGlobal('fetch', oauth);
    const { bx24OAuth } = await import('./oauth-client');
    const results = await Promise.all(
      [1, 2, 3].map(() => bx24OAuth('m', 'user.current', {}, { asUser: '9' })),
    );
    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(oauth).toHaveBeenCalledTimes(1);
  });

  it('отказ портала на refresh_token не роняет запрос, если в базе уже новый токен', async () => {
    stored = { ...stored, access_token: 'old', refresh_token: 'r2' };
    // Другой процесс успел обновить токен между нашим чтением и обращением к порталу.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        stored = { ...stored, access_token: 'other' };
        return Response.json({ error: 'invalid_grant' });
      }),
    );
    const { refreshToken } = await import('./oauth-client');
    await expect(refreshToken('m', 'old', '9')).resolves.toBe('other');
  });
});
