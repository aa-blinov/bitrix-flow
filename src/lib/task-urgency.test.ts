import { describe, expect, it } from 'vitest';
import { isDueThisWeek, needsDeadlineAttention } from './task-urgency';

const now = new Date(2025, 0, 10, 14);

const task = (dueDate?: string, status = 'new') => ({ dueDate, status });

describe('needsDeadlineAttention', () => {
  it('highlights overdue tasks and deadlines through tomorrow', () => {
    expect(needsDeadlineAttention(task('2025-01-09T23:59:00'), now)).toBe(true);
    expect(needsDeadlineAttention(task('2025-01-10T00:01:00'), now)).toBe(true);
    expect(needsDeadlineAttention(task('2025-01-11T23:59:00'), now)).toBe(true);
    expect(needsDeadlineAttention(task('2025-01-12T00:01:00'), now)).toBe(false);
  });

  it('does not highlight completed tasks', () => {
    expect(needsDeadlineAttention(task('2025-01-09T23:59:00', 'done'), now)).toBe(false);
  });

  it('finds unfinished tasks due in the next week', () => {
    expect(isDueThisWeek(task('2025-01-10T23:59:00'), now)).toBe(true);
    expect(isDueThisWeek(task('2025-01-17T23:59:00'), now)).toBe(true);
    expect(isDueThisWeek(task('2025-01-18T00:01:00'), now)).toBe(false);
  });
});
