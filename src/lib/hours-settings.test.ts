import { describe, expect, it } from 'vitest';
import { normalizeHoursSettings } from './hours-settings';

describe('настройки часов', () => {
  it('отбрасывает мусор и не принимает неверную норму', () => {
    expect(
      normalizeHoursSettings({
        excludedUserIds: ['15', '15', 'x', 7],
        dailyHours: 8,
        threshold: 0.8,
        perUser: { '3': 4, '4': 30, bad: 2 },
      }),
    ).toEqual({ excludedUserIds: ['15'], dailyHours: 8, threshold: 0.8, perUser: { '3': 4 } });
    expect(normalizeHoursSettings({ dailyHours: 0, threshold: 0.8 })).toBeNull();
    expect(normalizeHoursSettings({ dailyHours: 8, threshold: 1.5 })).toBeNull();
  });
});
