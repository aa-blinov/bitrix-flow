import { describe, expect, it, vi } from 'vitest';

const getDb = vi.fn(async () => {
  throw new Error('NO_DB');
});
vi.mock('./mongo', () => ({ getDb }));
vi.mock('./oauth-client', () => ({ bx24OAuth: {} }));

describe('refreshWorkloadTime', () => {
  it('второй вызов той же недели ждёт идущий сбор, а не запускает свой', async () => {
    const { refreshWorkloadTime } = await import('./workload-time');
    const first = refreshWorkloadTime('m', '2026-11-16', '2026-11-22');
    const second = refreshWorkloadTime('m', '2026-11-16', '2026-11-22');
    expect(second).toBe(first);
    await expect(first).rejects.toThrow('NO_DB');
    expect(getDb).toHaveBeenCalledTimes(1);
    // После конца сбора новый вызов снова идёт в портал.
    await expect(refreshWorkloadTime('m', '2026-11-16', '2026-11-22')).rejects.toThrow('NO_DB');
    expect(getDb).toHaveBeenCalledTimes(2);
  });
});
