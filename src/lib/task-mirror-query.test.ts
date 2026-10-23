import { describe, expect, it } from 'vitest';
import { taskMergeStages, timezoneOffsetString } from './task-mirror-query';

describe('timezoneOffsetString', () => {
  it('matches the local offset the browser uses for calendar day keys', () => {
    const date = new Date('2026-09-07T00:00:00');
    const minutes = -date.getTimezoneOffset();
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const expected = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    expect(timezoneOffsetString(date)).toBe(expected);
    expect(timezoneOffsetString(date)).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

describe('taskMergeStages', () => {
  const stages = taskMergeStages('member-1');

  const sortStage = stages.find((stage) => '$sort' in stage) as { $sort: Record<string, number> };

  it('sorts by freshness before collection priority', () => {
    // Раньше приоритет коллекции стоял первым, и свежая правка из зеркала
    // проигрывала устаревшей строке из `tasks` до следующего прохода поллера.
    const keys = Object.keys(sortStage.$sort);
    expect(keys.indexOf('freshAt')).toBeLessThan(keys.indexOf('priority'));
    expect(sortStage.$sort.freshAt).toBe(-1);
  });

  it('gives both collections a freshness marker', () => {
    // Зеркало: свежесть по synced_at, фоновый синк: по updated_at.
    const setStages = stages.filter((stage) => '$set' in stage) as Array<{
      $set: Record<string, unknown>;
    }>;
    const mirrorFreshAt = setStages.find((stage) => 'freshAt' in stage.$set)?.$set.freshAt;
    expect(mirrorFreshAt).toEqual({ $ifNull: ['$synced_at', '$updated_at'] });

    const unionStage = stages.find((stage) => '$unionWith' in stage) as {
      $unionWith: { pipeline: Array<Record<string, unknown>> };
    };
    const tasksSet = unionStage.$unionWith.pipeline.find((stage) => '$set' in stage) as {
      $set: Record<string, unknown>;
    };
    expect(tasksSet.$set.freshAt).toBe('$updated_at');
  });

  it('groups rows by task id after sorting', () => {
    const groupIndex = stages.findIndex((stage) => '$group' in stage);
    const sortIndex = stages.findIndex((stage) => '$sort' in stage);
    expect(sortIndex).toBeGreaterThanOrEqual(0);
    expect(groupIndex).toBeGreaterThan(sortIndex);
  });
});
