import { describe, expect, it } from 'vitest';
import { bucketize, effectiveSeconds, type WorkloadTask } from './workload';

const H = 3600;
const task = (id: string, parent: string, hours: number) => ({ id, parent, seconds: hours * H });

describe('effectiveSeconds', () => {
  it('counts a parent only when none of its subtasks carries an estimate', () => {
    const result = effectiveSeconds([
      task('p', '', 10),
      task('a', 'p', 3),
      task('b', 'p', 0),
      task('solo', '0', 5),
      task('p2', '', 8),
      task('c', 'p2', 0),
    ]);
    expect(result.get('p')).toBe(0);
    expect(result.get('a')).toBe(3 * H);
    expect(result.get('b')).toBe(0);
    expect(result.get('solo')).toBe(5 * H);
    // Подзадача без оценки не отменяет оценку родителя.
    expect(result.get('p2')).toBe(8 * H);
  });

  it('looks through every level and survives a parent cycle', () => {
    const deep = effectiveSeconds([task('g', '', 20), task('p', 'g', 6), task('c', 'p', 2)]);
    expect([deep.get('g'), deep.get('p'), deep.get('c')]).toEqual([0, 0, 2 * H]);
    const cycle = effectiveSeconds([task('x', 'y', 1), task('y', 'x', 1)]);
    expect(cycle.size).toBe(2);
  });
});

describe('bucketize', () => {
  const range = {
    weekStart: new Date('2026-10-19T00:00:00'),
    weekEnd: new Date('2026-10-26T00:00:00'),
    today: new Date('2026-10-24T00:00:00'),
  };
  const open = (
    id: string,
    parent: string,
    hours: number,
    assignee: string,
    day: string | null,
  ): WorkloadTask => ({
    ...task(id, parent, hours),
    assignee,
    day,
    deadline: day ? new Date(`${day}T10:00:00`) : null,
  });

  it('keeps the task count but does not count parent and subtask hours twice', () => {
    const { days, noDeadline, overdue } = bucketize(
      [
        open('p', '', 10, 'anna', '2026-10-22'),
        open('a', 'p', 4, 'anna', '2026-10-22'),
        open('b', 'p', 2, 'ivan', '2026-10-23'),
        open('free', '', 3, 'anna', null),
      ],
      range,
    );
    const anna = days.find((row) => row.userId === 'anna' && row.day === '2026-10-22');
    expect(anna).toMatchObject({ count: 2, hours: 4 });
    expect(days.find((row) => row.userId === 'ivan')).toMatchObject({ count: 1, hours: 2 });
    expect(noDeadline).toEqual([{ userId: 'anna', count: 1, hours: 3 }]);
    expect(overdue).toHaveLength(2);
  });
});
