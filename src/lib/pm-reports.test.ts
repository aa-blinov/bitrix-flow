import { describe, expect, it } from 'vitest';
import {
  clientReport,
  deadlines,
  defects,
  planFact,
  stale,
  throughput,
  timesheets,
  weekNorm,
  type ReportTask,
} from './pm-reports';

const H = 3600;
const task = (id: string, patch: Partial<ReportTask> = {}): ReportTask => ({
  id,
  title: `#${id}`,
  projectId: '10',
  parentId: '',
  status: '2',
  responsibleId: '1',
  created: '2026-10-01T10:00:00+03:00',
  closed: '',
  deadline: '',
  activity: '2026-10-01T10:00:00+03:00',
  estimate: 0,
  spent: 0,
  ...patch,
});
const tile = (result: { tiles: { id: string; value: number | null }[] }, id: string) =>
  result.tiles.find((item) => item.id === id)?.value;
const NOW = Date.parse('2026-11-14T12:00:00+03:00');

describe('план и факт', () => {
  it('факт задачи включает подзадачи без оценки, подзадача с оценкой идёт своей строкой', () => {
    const result = planFact(
      [
        task('1', { estimate: 10 * H, spent: 4 * H }),
        task('2', { parentId: '1', spent: 3 * H }),
        task('3', { parentId: '1', estimate: 2 * H, spent: 5 * H }),
        task('4', { parentId: '3', spent: 1 * H }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    const rows = Object.fromEntries(result.tables[0].rows.map((row) => [row.taskId, row]));
    expect(rows['1']).toMatchObject({ plan: 10, fact: 7, delta: -3 });
    expect(rows['3']).toMatchObject({ plan: 2, fact: 6, delta: 4 });
    expect(tile(result, 'plan')).toBe(12);
    expect(tile(result, 'fact')).toBe(13);
    expect(tile(result, 'overrun')).toBe(4);
    expect(tile(result, 'overTasks')).toBe(1);
  });

  it('закрытая задача попадает, только если закрыта в периоде', () => {
    const result = planFact(
      [
        task('1', { estimate: H, status: '5', closed: '2026-10-31T23:00:00+03:00' }),
        task('2', { estimate: H, status: '5', closed: '2026-11-01T00:30:00+03:00' }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(result.tables[0].rows.map((row) => row.taskId)).toEqual(['2']);
  });
});

describe('сроки', () => {
  it('опоздание считается по моменту дедлайна, просрочка только у активных', () => {
    const result = deadlines(
      [
        task('1', {
          status: '5',
          deadline: '2026-11-03T18:00:00+03:00',
          closed: '2026-11-05T10:00:00+03:00',
        }),
        task('2', {
          status: '5',
          deadline: '2026-11-03T18:00:00+03:00',
          closed: '2026-11-03T17:00:00+03:00',
        }),
        task('3', { status: '5', closed: '2026-11-04T10:00:00+03:00' }),
        task('4', { deadline: '2026-11-10T18:00:00+03:00' }),
        task('5', { status: '6', deadline: '2026-11-10T18:00:00+03:00' }),
        task('6', { deadline: '2026-11-20T18:00:00+03:00' }),
      ],
      '2026-11-01',
      '2026-11-30',
      NOW,
    );
    expect(tile(result, 'closedWithDeadline')).toBe(2);
    expect(tile(result, 'late')).toBe(1);
    expect(tile(result, 'onTime')).toBe(0.5);
    expect(tile(result, 'overdue')).toBe(1);
    const rows = Object.fromEntries(result.tables[0].rows.map((row) => [row.taskId, row]));
    expect(rows['1']).toMatchObject({ state: 'late', days: 2 });
    expect(rows['4']).toMatchObject({ state: 'overdue', days: 4 });
  });
});

describe('поток задач', () => {
  it('создано, закрыто, открытых на конец недели и медиана дней до закрытия', () => {
    const result = throughput(
      [
        task('1', {
          created: '2026-11-02T10:00:00+03:00',
          status: '5',
          closed: '2026-11-04T10:00:00+03:00',
        }),
        task('2', { created: '2026-11-03T10:00:00+03:00' }),
        task('3', {
          created: '2026-10-20T10:00:00+03:00',
          status: '5',
          closed: '2026-11-12T10:00:00+03:00',
        }),
      ],
      ['2026-11-02', '2026-11-09'],
    );
    expect(result.tables[0].rows).toEqual([
      { week: '2026-11-02', created: 2, closed: 1, net: 1, backlog: 2, lead: 2 },
      { week: '2026-11-09', created: 0, closed: 1, net: -1, backlog: 1, lead: 23 },
    ]);
    expect(tile(result, 'lead')).toBe(12.5);
  });
});

describe('брак', () => {
  it('доля брака от коммерции и брака, прочие классы не входят', () => {
    const result = defects([
      { month: '2026-11', projectId: '10', hourClass: 'commercial', hours: 30 },
      { month: '2026-11', projectId: '10', hourClass: 'defect', hours: 10 },
      { month: '2026-11', projectId: '10', hourClass: 'internal', hours: 99 },
    ]);
    expect(result.tables[0].rows).toEqual([
      { projectId: '10', month: '2026-11', commercial: 30, defect: 10, share: 0.25 },
    ]);
    expect(tile(result, 'share')).toBe(0.25);
  });
});

describe('списание часов', () => {
  it('норма это будни недели внутри периода', () => {
    expect(weekNorm('2026-11-09', '2026-11-01', '2026-11-30', 8)).toBe(40);
    expect(weekNorm('2026-10-26', '2026-11-01', '2026-11-30', 8)).toBe(0);
    expect(weekNorm('2026-11-09', '2026-11-01', '2026-11-11', 8)).toBe(24);
  });

  it('человек без списаний попадает в отчёт с нулём', () => {
    const result = timesheets(
      [
        { userId: '1', day: '2026-11-10', seconds: 30 * H, taskId: '5' },
        { userId: '1', day: '2026-11-08', seconds: 5 * H, taskId: '5' },
      ],
      ['1', '2'],
      ['2026-11-09'],
      '2026-11-09',
      '2026-11-15',
      [],
    );
    expect(result.tables[0].rows).toEqual([
      { userId: '1', week: '2026-11-09', fact: 30, norm: 40, share: 0.75 },
      { userId: '2', week: '2026-11-09', fact: 0, norm: 40, share: 0 },
    ]);
    expect(tile(result, 'below')).toBe(2);
  });
});

describe('зависшие задачи', () => {
  it('причины считаются по активным задачам, отложенные и закрытые не попадают', () => {
    const result = stale(
      [
        task('1', {
          activity: '2026-10-01T10:00:00+03:00',
          deadline: '2026-12-01T10:00:00+03:00',
          estimate: H,
        }),
        task('2', {
          activity: '2026-11-13T10:00:00+03:00',
          deadline: '2026-11-10T10:00:00+03:00',
          estimate: H,
        }),
        task('3', { activity: '2026-11-13T10:00:00+03:00', estimate: H }),
        task('4', { status: '6', activity: '2026-01-01T10:00:00+03:00' }),
        task('5', { status: '5', activity: '2026-01-01T10:00:00+03:00' }),
        task('6', {
          activity: '2026-11-13T10:00:00+03:00',
          deadline: '2026-12-01T10:00:00+03:00',
          estimate: H,
        }),
      ],
      14,
      null,
      NOW,
    );
    expect(result.tables[0].rows.map((row) => [row.taskId, row.reasons])).toEqual([
      ['1', 'idle'],
      ['2', 'overdue'],
      ['3', 'noDeadline'],
    ]);
    expect(result.tiles.map((item) => item.value)).toEqual([1, 1, 1, 0]);
    expect(
      stale([task('1', { activity: '2026-10-01T10:00:00+03:00' })], 14, 'overdue', NOW).tables[0]
        .rows,
    ).toEqual([]);
  });
});

describe('отчёт клиенту', () => {
  it('часы за период по задачам проекта, закрытые в периоде и открытые', () => {
    const result = clientReport(
      [
        task('1', { status: '5', closed: '2026-11-05T10:00:00+03:00' }),
        task('2'),
        task('3', { projectId: '20' }),
      ],
      [
        { userId: '1', day: '2026-11-04', seconds: 2 * H, taskId: '1' },
        { userId: '2', day: '2026-11-04', seconds: H, taskId: '2' },
        { userId: '2', day: '2026-10-30', seconds: H, taskId: '2' },
        { userId: '2', day: '2026-11-04', seconds: H, taskId: '3' },
      ],
      '10',
      '2026-11-01',
      '2026-11-30',
    );
    expect(result.tiles.map((item) => item.value)).toEqual([1, 1, 3]);
    expect(result.tables[2].rows).toEqual([
      { userId: '1', hours: 2 },
      { userId: '2', hours: 1 },
    ]);
  });
});
