import { describe, expect, it } from 'vitest';
import { GRACE_S, pollerWarnings } from './health';

const now = Date.parse('2026-10-25T12:00:00Z');
const idleChat = { active: false, lastOkAt: 0, lastError: '' };

describe('pollerWarnings', () => {
  it('stays quiet while healthy and right after a restart', () => {
    const fresh = { lastOkAt: now - 30_000, lastError: '' };
    expect(pollerWarnings({ tasks: fresh, chat: idleChat, now, uptimeSeconds: 3600 })).toEqual([]);
    const never = { lastOkAt: 0, lastError: '' };
    expect(pollerWarnings({ tasks: never, chat: idleChat, now, uptimeSeconds: 60 })).toEqual([]);
  });

  it('warns when the task poller has had no good pass for five minutes', () => {
    const stale = { lastOkAt: now - 10 * 60_000, lastError: 'fetch failed' };
    const [warning] = pollerWarnings({ tasks: stale, chat: idleChat, now, uptimeSeconds: 3600 });
    expect(warning).toContain('tasks-poller-stale');
    expect(warning).toContain('fetch failed');
    const never = { lastOkAt: 0, lastError: '' };
    expect(
      pollerWarnings({ tasks: never, chat: idleChat, now, uptimeSeconds: GRACE_S + 60 }),
    ).toHaveLength(1);
  });

  it('warns about chat events only while a tab is open', () => {
    const tasks = { lastOkAt: now - 1000, lastError: '' };
    const stuck = { active: true, lastOkAt: now - 120_000, lastError: 'timeout' };
    expect(pollerWarnings({ tasks, chat: stuck, now, uptimeSeconds: 3600 })[0]).toContain(
      'messenger-events-stale',
    );
    expect(
      pollerWarnings({ tasks, chat: { ...stuck, active: false }, now, uptimeSeconds: 3600 }),
    ).toEqual([]);
  });
});
