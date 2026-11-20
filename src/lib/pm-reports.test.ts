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

describe('план и факт: округление и задачи без оценки', () => {
  it('итоги по секундам, перерасход совпадает со строками, часы без оценки видны', () => {
    const result = planFact(
      [
        ...Array.from({ length: 100 }, (_, index) => task(String(index + 1), { estimate: 20 })),
        task('200', { estimate: H, spent: H + 18 }),
        task('300', { spent: 5 * H }),
        task('301', { parentId: '200', spent: 2 * H }),
        task('400', { status: '6', estimate: H }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(tile(result, 'plan')).toBe((100 * 20 + 2 * H) / 3600);
    expect(tile(result, 'overTasks')).toBe(1);
    expect(tile(result, 'unestimated')).toBe(5);
    expect(result.tables[1].rows.map((row) => row.taskId)).toEqual(['300']);
    const rows = Object.fromEntries(result.tables[0].rows.map((row) => [row.taskId, row]));
    expect(rows['200']).toMatchObject({ fact: 3 + 18 / 3600, subFact: 2, filters: 'over' });
    expect(rows['400']).toMatchObject({ state: 'paused' });
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
    expect(rows['1']).toMatchObject({ state: 'late', days: 2, filters: 'closed,late' });
    expect(rows['2']).toMatchObject({ state: 'onTime', days: null, filters: 'closed,onTime' });
    expect(rows['4']).toMatchObject({ state: 'overdue', days: 4, filters: 'overdue' });
  });

  it('опоздание и его дни считаются до минуты', () => {
    const result = deadlines(
      [
        task('1', {
          status: '5',
          deadline: '2026-11-10T12:00:00+03:00',
          closed: '2026-11-11T12:00:30+03:00',
        }),
        task('2', {
          status: '5',
          deadline: '2026-11-10T12:00:00+03:00',
          closed: '2026-11-10T12:00:40+03:00',
        }),
      ],
      '2026-11-01',
      '2026-11-30',
      NOW,
    );
    const rows = Object.fromEntries(result.tables[0].rows.map((row) => [row.taskId, row]));
    expect(rows['1']).toMatchObject({ state: 'late', days: 1 });
    expect(rows['2']).toMatchObject({ state: 'onTime' });
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
      '2026-11-02',
      '2026-11-15',
    );
    expect(result.tables[0].rows).toEqual([
      { week: '2026-11-02..2026-11-08', created: 2, closed: 1, net: 1, backlog: 2, lead: 2 },
      { week: '2026-11-09..2026-11-15', created: 0, closed: 1, net: -1, backlog: 1, lead: 23 },
    ]);
    expect(tile(result, 'lead')).toBe(12.5);
    expect(result.tables[1].rows.map((row) => [row.taskId, row.filters, row.lead])).toEqual([
      ['1', 'created,closed,lead', 2],
      ['2', 'created', null],
      ['3', 'closed,lead', 23],
    ]);
  });

  it('крайние недели обрезаются периодом: понедельник до среды в поток не попадает', () => {
    const result = throughput(
      [
        task('1', { created: '2026-11-02T10:00:00+03:00' }),
        task('2', { created: '2026-11-04T10:00:00+03:00' }),
        task('3', { status: '5', closed: '2026-11-07T10:00:00+03:00' }),
      ],
      ['2026-11-02'],
      '2026-11-04',
      '2026-11-06',
    );
    expect(result.tables[0].rows[0]).toMatchObject({
      week: '2026-11-04..2026-11-06',
      created: 1,
      closed: 0,
      backlog: 4 - 1,
    });
    expect(tile(result, 'created')).toBe(1);
    expect(tile(result, 'closed')).toBe(0);
  });
});

describe('брак', () => {
  it('доля брака от коммерции и брака, прочие классы не входят', () => {
    const result = defects(
      [
        { month: '2026-11', projectId: '10', hourClass: 'commercial', hours: 30 },
        { month: '2026-11', projectId: '10', hourClass: 'defect', hours: 10 },
        { month: '2026-11', projectId: '10', hourClass: 'internal', hours: 99 },
      ],
      '2026-10-15',
      '2026-11-20',
    );
    expect(result.tables[0].rows).toEqual([
      {
        projectId: '10',
        month: '2026-11',
        commercial: 30,
        defect: 10,
        share: 0.25,
        from: '2026-11-01',
        to: '2026-11-20',
      },
    ]);
    expect(tile(result, 'share')).toBe(0.25);
    expect(tile(result, 'outside')).toBe(99);
  });

  it('итог считается по точным часам, а не по сумме округлённых строк', () => {
    const rows = ['10', '20'].map((projectId) => ({
      month: '2026-11',
      projectId,
      hourClass: 'defect',
      hours: 18 / 3600,
    }));
    expect(tile(defects(rows, '2026-11-01', '2026-11-30'), 'defect')).toBe(0.01);
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
    expect(result.tables[1].rows).toEqual([
      { userId: '1', week: '2026-11-09', fact: 30, norm: 40, share: 0.75, filters: 'below' },
      { userId: '2', week: '2026-11-09', fact: 0, norm: 40, share: 0, filters: 'below' },
    ]);
    expect(tile(result, 'below')).toBe(2);
  });

  it('своя норма и порог из настроек', () => {
    const result = timesheets(
      [
        { userId: '1', day: '2026-11-10', seconds: 15 * H, taskId: '5' },
        { userId: '2', day: '2026-11-10', seconds: 30 * H, taskId: '5' },
      ],
      ['1', '2'],
      ['2026-11-09'],
      '2026-11-09',
      '2026-11-15',
      [],
      { dailyHours: 8, threshold: 0.7, perUser: { '1': 4 } },
    );
    // У первого норма 4 ч в день: 15 из 20 это 75 %, выше порога 70 %. У второго 30 из 40.
    expect(result.tables[0].rows.map((row) => [row.userId, row.norm, row.filters])).toEqual([
      ['1', 20, ''],
      ['2', 40, ''],
    ]);
    expect(tile(result, 'below')).toBe(0);
  });

  it('порог 80 % считается по секундам и за весь период', () => {
    const almost = 32 * H - 1;
    const result = timesheets(
      [
        { userId: '1', day: '2026-11-10', seconds: almost, taskId: '5' },
        { userId: '2', day: '2026-11-03', seconds: 20 * H, taskId: '5' },
        { userId: '2', day: '2026-11-10', seconds: 44 * H, taskId: '5' },
      ],
      ['1', '2'],
      ['2026-11-02', '2026-11-09'],
      '2026-11-09',
      '2026-11-15',
      [],
    );
    // Первая неделя вне периода: норма за неё ноль, и списания за неё не считаются.
    expect(result.tables[0].rows).toEqual([
      { userId: '1', fact: almost / 3600, norm: 40, share: almost / 3600 / 40, filters: 'below' },
      { userId: '2', fact: 44, norm: 40, share: 1.1, filters: '' },
    ]);
    expect(tile(result, 'below')).toBe(1);
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
      NOW,
    );
    expect(result.tables[0].rows.map((row) => [row.taskId, row.reasons])).toEqual([
      ['1', 'idle'],
      ['2', 'overdue'],
      ['3', 'noDeadline'],
    ]);
    expect(result.tiles.map((item) => item.value)).toEqual([1, 1, 1, 0]);
    expect(result.tables[0].rows.map((row) => row.filters)).toEqual([
      'idle',
      'overdue',
      'noDeadline',
    ]);
  });

  it('задача без даты активности считается от создания, а не выпадает', () => {
    const result = stale(
      [
        task('1', {
          activity: '',
          created: '2026-10-01T10:00:00+03:00',
          deadline: '2026-12-01T10:00:00+03:00',
          estimate: H,
        }),
      ],
      14,
      NOW,
    );
    expect(result.tables[0].rows[0]).toMatchObject({ taskId: '1', reasons: 'idle', idle: 44 });
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
    expect(result.tables[3].rows).toEqual([
      { userId: '1', hours: 2 },
      { userId: '2', hours: 1 },
    ]);
  });

  it('отложенная не в работе, а часы по закрытой раньше задаче не теряются', () => {
    const result = clientReport(
      [
        task('1', { status: '5', closed: '2026-10-20T10:00:00+03:00' }),
        task('2', { status: '6' }),
        task('3'),
      ],
      [
        { userId: '1', day: '2026-11-04', seconds: 2 * H, taskId: '1' },
        { userId: '1', day: '2026-11-04', seconds: H, taskId: '9', projectId: '10' },
      ],
      '10',
      '2026-11-01',
      '2026-11-30',
    );
    expect(tile(result, 'open')).toBe(1);
    expect(tile(result, 'hours')).toBe(3);
    expect(result.tables[2].rows.map((row) => [row.taskId, row.periodHours])).toEqual([
      ['1', 2],
      ['9', 1],
    ]);
  });
});
