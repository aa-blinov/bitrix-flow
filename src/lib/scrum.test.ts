import { describe, expect, it } from 'vitest';
import { nextSprintDates, sprintStats, type ScrumTask } from './scrum-shared';

const task = (patch: Partial<ScrumTask>): ScrumTask => ({
  id: '1',
  title: '',
  status: '2',
  done: false,
  responsibleId: '9',
  responsible: 'Блинов',
  deadline: null,
  estimateHours: 0,
  size: null,
  ...patch,
});

describe('nextSprintDates', () => {
  it('starts on the next Monday when there are no sprints', () => {
    // Пятница 27.11.2026: первый спринт с понедельника 30.11 по воскресенье 06.12.
    expect(nextSprintDates([], new Date('2026-11-27T10:00:00Z'))).toEqual({
      dateStart: '2026-11-30T00:00:00+03:00',
      dateEnd: '2026-12-06T23:59:59+03:00',
    });
    // В понедельник новый спринт начинается со следующего: текущая неделя уже идёт.
    expect(nextSprintDates([], new Date('2026-11-30T10:00:00Z')).dateStart).toBe(
      '2026-12-07T00:00:00+03:00',
    );
  });

  it('continues right after the latest sprint', () => {
    const sprints = [
      { dateEnd: '2026-12-06T23:59:59+03:00' },
      { dateEnd: '2026-12-13T23:59:59+03:00' },
      { dateEnd: null },
    ];
    expect(nextSprintDates(sprints, new Date('2026-11-27T10:00:00Z'))).toEqual({
      dateStart: '2026-12-14T00:00:00+03:00',
      dateEnd: '2026-12-20T23:59:59+03:00',
    });
  });
});

describe('sprintStats', () => {
  it('sums t-shirt points and capacity by person', () => {
    const stats = sprintStats([
      task({ id: '1', size: 'M', estimateHours: 4 }),
      task({ id: '2', size: 'L', done: true, status: '5' }),
      task({ id: '3', size: null, responsibleId: '', responsible: '' }),
    ]);
    expect(stats).toMatchObject({ tasks: 3, done: 1, points: 8, donePoints: 5, unsized: 1 });
    expect(stats.people[0]).toMatchObject({ id: '9', tasks: 2, points: 8, estimateHours: 4 });
    expect(stats.people[1]).toMatchObject({ id: 'unassigned', name: 'Не назначен', points: 0 });
  });
});
