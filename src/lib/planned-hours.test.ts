import { describe, expect, it } from 'vitest';
import { planForPeriod, rollupPlan, type PlanTask } from './planned-hours';

const task = (id: string, parentId: string, hours: number, extra: Partial<PlanTask> = {}) => ({
  id,
  parentId,
  estimate: hours * 3600,
  ...extra,
});

describe('rollupPlan', () => {
  it('takes children over the parent and falls back to the parent when children are empty', () => {
    const plan = rollupPlan([
      task('a', '', 8),
      task('a1', 'a', 3),
      task('a2', 'a', 5),
      task('b', '', 6),
      task('b1', 'b', 0),
    ]);
    expect(plan.plannedSeconds).toBe(14 * 3600);
    expect(plan.warnings).toBe(0);
  });

  it('warns when the parent estimate disagrees with its decomposition', () => {
    const plan = rollupPlan([task('a', '', 10), task('a1', 'a', 4)]);
    expect(plan.plannedSeconds).toBe(4 * 3600);
    expect(plan.warnings).toBe(1);
    expect(plan.varianceSeconds).toBe(6 * 3600);
  });

  it('treats a task whose parent is outside the list as a root', () => {
    expect(rollupPlan([task('a1', 'elsewhere', 2)]).plannedSeconds).toBe(2 * 3600);
  });
});

describe('planForPeriod', () => {
  const tasks = [
    task('a', '', 8, { created: '2026-03-01T10:00:00', deadline: '2026-03-20T10:00:00' }),
    task('a1', 'a', 3, { created: '2026-05-01T10:00:00' }),
    task('a2', 'a', 5, { created: '2026-05-01T10:00:00' }),
    task('b', '', 4, { created: '2026-04-10T10:00:00' }),
    task('c', '', 2),
  ];

  it('counts root plans whose created..deadline window touches the period', () => {
    expect(planForPeriod(tasks, '2026-03-15', '2026-03-31')).toBe(8 * 3600);
    expect(planForPeriod(tasks, '2026-04-01', '2026-04-30')).toBe(4 * 3600);
    expect(planForPeriod(tasks, '2026-01-01', '2026-12-31')).toBe(12 * 3600);
    expect(planForPeriod(tasks, '2026-06-01', '2026-06-30')).toBe(0);
  });
});
