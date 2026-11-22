import { describe, expect, it } from 'vitest';
import { bucketDeadline, deadlineBucket } from './deadline-buckets';

// Среда, 18 марта 2026, полдень по местному времени.
const now = new Date(2026, 2, 18, 12, 0);

describe('deadline-buckets', () => {
  it('раскладывает сроки по колонкам', () => {
    expect(deadlineBucket(undefined, now)).toBe('none');
    expect(deadlineBucket(new Date(2026, 2, 18, 10).toISOString(), now)).toBe('overdue');
    expect(deadlineBucket(new Date(2026, 2, 18, 19).toISOString(), now)).toBe('today');
    expect(deadlineBucket(new Date(2026, 2, 22, 19).toISOString(), now)).toBe('week');
    expect(deadlineBucket(new Date(2026, 2, 23, 9).toISOString(), now)).toBe('next');
    expect(deadlineBucket(new Date(2026, 2, 30, 9).toISOString(), now)).toBe('later');
  });
  it('перенос ставит конец периода в 19:00', () => {
    expect(new Date(bucketDeadline('today', now)!).getDate()).toBe(18);
    expect(new Date(bucketDeadline('week', now)!).getDate()).toBe(22);
    expect(new Date(bucketDeadline('next', now)!).getDate()).toBe(29);
    expect(new Date(bucketDeadline('next', now)!).getHours()).toBe(19);
    expect(bucketDeadline('none', now)).toBeNull();
    expect(bucketDeadline('overdue', now)).toBeUndefined();
  });
});
