import { describe, expect, it } from 'vitest';
import { parseDeadlineChange } from './deadline-changes';
import { shifts, type ReportTask } from './pm-reports';

const link = '[URL=/workgroups/group/95/tasks/task/view/1/?chatAction=changeDeadline]';

describe('разбор переносов срока', () => {
  it('смена и снятие срока это переносы, постановка и напоминания нет', () => {
    expect(
      parseDeadlineChange(
        `[USER=11]Екатерина[/USER] изменила крайний срок задачи на ${link}[TIMESTAMP=1797004800 FORMAT=LONG_DATE_FORMAT], [TIMESTAMP=1797004800 FORMAT=SHORT_TIME_FORMAT][/URL]`,
      ),
    ).toEqual({ actorId: '11', kind: 'moved', deadline: '2026-12-11T19:00:00+03:00' });
    expect(
      parseDeadlineChange(`[USER=9]Александр[/USER] удалил ${link}крайний срок[/URL] задачи`),
    ).toEqual({ actorId: '9', kind: 'removed', deadline: '' });
    expect(
      parseDeadlineChange(
        `[USER=11]Е[/USER] установил крайний срок задачи на ${link}[TIMESTAMP=1797004800 FORMAT=LONG_DATE_FORMAT][/URL]`,
      ),
    ).toBeNull();
    expect(
      parseDeadlineChange(
        `[USER=9]А[/USER], задача просрочена [TIMESTAMP=1795186800 FORMAT=LONG_DATE_FORMAT]\nЗавершите её или ${link}измените крайний срок[/URL]`,
      ),
    ).toBeNull();
  });
});

const task = (id: string, patch: Partial<ReportTask> = {}): ReportTask => ({
  id,
  title: `T${id}`,
  projectId: '1',
  parentId: '',
  status: '3',
  responsibleId: '5',
  created: '',
  closed: '',
  deadline: '2026-11-30T19:00:00+03:00',
  activity: '',
  estimate: 0,
  spent: 0,
  ...patch,
});

describe('отчёт переносов', () => {
  it('считает переносы по задачам, повторные и снятые, вне периода и чужие не берёт', () => {
    const event = (taskId: string, at: string, kind: 'moved' | 'removed' = 'moved') => ({
      taskId,
      actorId: '7',
      kind,
      deadline: kind === 'moved' ? '2026-11-30T19:00:00+03:00' : '',
      at,
    });
    const result = shifts(
      [
        event('1', '2026-11-03T10:00:00+03:00'),
        event('1', '2026-11-10T10:00:00+03:00', 'removed'),
        event('2', '2026-11-05T10:00:00+03:00'),
        event('2', '2026-10-20T10:00:00+03:00'),
        event('3', '2026-11-05T10:00:00+03:00'),
      ],
      [task('1'), task('2')],
      '2026-11-01',
      '2026-11-30',
    );
    expect(result.tiles.map((tile) => [tile.id, tile.value])).toEqual([
      ['shifts', 3],
      ['tasks', 2],
      ['repeat', 1],
      ['removed', 1],
    ]);
    const [tasks, events] = result.tables;
    expect(tasks.rows.map((row) => [row.taskId, row.shifts, row.filters])).toEqual([
      ['1', 2, 'repeat,removed'],
      ['2', 1, ''],
    ]);
    expect(events.rows.map((row) => [row.taskId, row.userId, row.change])).toEqual([
      ['1', '7', 'moved'],
      ['2', '7', 'moved'],
      ['1', '7', 'removed'],
    ]);
  });
});
