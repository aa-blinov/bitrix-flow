import { describe, expect, it } from 'vitest';
import { drillWidget, runWidget, type Widget } from './dashboards';
import { deadlines, throughput, type ReportTask } from './pm-reports';

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
const widget = (patch: Partial<Widget>): Widget => ({
  id: 'w',
  title: '',
  metric: 'closed',
  by: 'none',
  view: 'number',
  projectId: '',
  userId: '',
  wide: false,
  ...patch,
});
const NOW = Date.parse('2026-11-14T12:00:00+03:00');

const tasks = [
  task('1', {
    created: '2026-11-02T10:00:00+03:00',
    status: '5',
    deadline: '2026-11-03T18:00:00+03:00',
    closed: '2026-11-05T10:00:00+03:00',
  }),
  task('2', {
    created: '2026-11-03T10:00:00+03:00',
    responsibleId: '2',
    deadline: '2026-11-10T18:00:00+03:00',
  }),
  task('3', {
    created: '2026-10-20T10:00:00+03:00',
    status: '5',
    projectId: '20',
    deadline: '2026-11-20T18:00:00+03:00',
    closed: '2026-11-12T10:00:00+03:00',
  }),
  task('4', { status: '6', deadline: '2026-11-01T18:00:00+03:00' }),
];
const data = {
  tasks,
  entries: [
    { userId: '1', day: '2026-11-04', seconds: 2 * H, taskId: '1' },
    { userId: '2', day: '2026-11-10', seconds: 3 * H, taskId: '3' },
    { userId: '2', day: '2026-10-30', seconds: 5 * H, taskId: '3' },
  ],
  classes: new Map([['3', 'commercial']]),
};
const run = (patch: Partial<Widget>) =>
  runWidget(widget(patch), data, '2026-11-01', '2026-11-30', NOW);

describe('конструктор дашбордов', () => {
  it('числа сходятся с отчётами сроков и потока', () => {
    const report = deadlines(tasks, '2026-11-01', '2026-11-30', NOW);
    const tile = (id: string) => report.tiles.find((item) => item.id === id)?.value;
    expect(run({ metric: 'late' }).total).toBe(tile('late'));
    expect(run({ metric: 'onTime' }).total).toBe(tile('onTime'));
    expect(run({ metric: 'overdue' }).total).toBe(tile('overdue'));

    const flow = throughput(
      tasks,
      ['2026-10-26', '2026-11-02', '2026-11-09'],
      '2026-11-01',
      '2026-11-30',
    );
    const weeks = run({ metric: 'closed', by: 'week' }).points;
    expect(weeks.slice(0, 3).map((point) => point.value)).toEqual(
      flow.tables[0].rows.map((row) => row.closed),
    );
  });

  it('разрез по проекту и фильтр по человеку', () => {
    expect(run({ metric: 'closed', by: 'project' }).points).toEqual([
      { key: '10', value: 1, count: 1 },
      { key: '20', value: 1, count: 1 },
    ]);
    expect(run({ metric: 'created', userId: '2' }).total).toBe(1);
  });

  it('часы только за период, класс берётся по задаче', () => {
    expect(run({ metric: 'hours' }).total).toBe(5);
    expect(run({ metric: 'hours', by: 'class' }).points).toEqual([
      { key: 'commercial', value: 3, count: 1 },
      { key: 'unassigned', value: 2, count: 1 },
    ]);
    expect(run({ metric: 'hours', by: 'month' }).points).toEqual([
      { key: '2026-11', value: 5, count: 2 },
    ]);
  });

  it('медиана пустой недели это нет данных, а не ноль', () => {
    const points = run({ metric: 'leadTime', by: 'week' }).points;
    expect(points[0]).toEqual({ key: '2026-10-26', value: null, count: 0 });
    expect(points.find((point) => point.key === '2026-11-02')?.value).toBe(3);
  });

  it('разрез, которого у метрики нет, превращается в итог', () => {
    expect(run({ metric: 'open', by: 'week' })).toEqual({ total: 1, count: 1, points: [] });
  });

  it('список за точкой: те же задачи, что в числе, часы складываются по задаче', () => {
    const drill = (patch: Partial<Widget>, key: string | null) =>
      drillWidget(widget(patch), data, '2026-11-01', '2026-11-30', key, NOW);
    expect(drill({ metric: 'closed', by: 'project' }, '20').map((row) => row.id)).toEqual(['3']);
    expect(drill({ metric: 'closed' }, null)).toHaveLength(run({ metric: 'closed' }).total!);
    expect(drill({ metric: 'overdue' }, null).map((row) => row.id)).toEqual(['2']);
    expect(drill({ metric: 'hours', by: 'class' }, 'commercial')).toEqual([
      {
        id: '3',
        title: '#3',
        projectId: '20',
        userId: '2',
        value: 3,
        deadline: '2026-11-20T18:00:00+03:00',
      },
    ]);
  });

  it('часы в списке за числом разделены по людям, а не записаны на первого', () => {
    const shared = {
      ...data,
      entries: [
        { userId: '1', day: '2026-11-04', seconds: 2 * H, taskId: '1' },
        { userId: '2', day: '2026-11-05', seconds: 3 * H, taskId: '1' },
      ],
    };
    const rows = drillWidget(
      widget({ metric: 'hours' }),
      shared,
      '2026-11-01',
      '2026-11-30',
      null,
      NOW,
    );
    expect(rows.map((row) => [row.id, row.userId, row.value])).toEqual([
      ['1', '2', 3],
      ['1', '1', 2],
    ]);
  });

  it('несобранная неделя у часов это нет данных, а не ноль', () => {
    const points = runWidget(
      widget({ metric: 'hours', by: 'week' }),
      { ...data, missingWeeks: ['2026-11-16'] },
      '2026-11-01',
      '2026-11-30',
      NOW,
    ).points;
    expect(points.find((point) => point.key === '2026-11-16')?.value).toBeNull();
    expect(points.find((point) => point.key === '2026-11-23')?.value).toBe(0);
  });

  it('доля в срок знает, из скольких задач она, и пропускает срок, который не разобрать', () => {
    const odd = {
      ...data,
      tasks: [
        ...tasks,
        task('9', { status: '5', closed: '2026-11-06T10:00:00+03:00', deadline: 'когда-нибудь' }),
      ],
    };
    const result = runWidget(widget({ metric: 'onTime' }), odd, '2026-11-01', '2026-11-30', NOW);
    expect(result).toMatchObject({ total: 0.5, count: 2 });
  });

  it('просрочка в списке идёт от самого старого срока, опоздания перед закрытыми в срок', () => {
    const many = {
      ...data,
      tasks: [
        task('5', { deadline: '2026-11-12T18:00:00+03:00' }),
        task('6', { deadline: '2026-11-02T18:00:00+03:00' }),
      ],
    };
    const drill = (patch: Partial<Widget>, source = many) =>
      drillWidget(widget(patch), source, '2026-11-01', '2026-11-30', null, NOW);
    expect(drill({ metric: 'overdue' }).map((row) => row.id)).toEqual(['6', '5']);
    expect(drill({ metric: 'onTime' }, data).map((row) => row.value)).toEqual([0, 1]);
  });

  it('задача без ответственного попадает в одну группу «0»', () => {
    const lone = {
      ...data,
      tasks: [task('7', { responsibleId: '' }), task('8', { responsibleId: '0' })],
    };
    expect(
      runWidget(widget({ metric: 'open', by: 'user' }), lone, '2026-11-01', '2026-11-30', NOW)
        .points,
    ).toEqual([{ key: '0', value: 2, count: 2 }]);
  });

  it('часы не округляются до показа: 40 секунд не превращаются в ноль', () => {
    const short = {
      ...data,
      entries: [1, 2].map(() => ({ userId: '1', day: '2026-11-04', seconds: 20, taskId: '1' })),
    };
    expect(
      runWidget(widget({ metric: 'hours' }), short, '2026-11-01', '2026-11-30', NOW).total,
    ).toBe(40 / 3600);
  });

  it('закрытие раньше создания не входит в медиану, опоздание считается до минуты', () => {
    const odd = {
      ...data,
      tasks: [
        task('1', {
          status: '5',
          created: '2026-11-10T10:00:00+03:00',
          closed: '2026-11-08T10:00:00+03:00',
        }),
        task('2', {
          status: '5',
          created: '2026-11-01T10:00:00+03:00',
          closed: '2026-11-11T10:00:00+03:00',
        }),
        task('3', {
          status: '5',
          deadline: '2026-11-05T12:00:00+03:00',
          closed: '2026-11-05T12:00:30+03:00',
        }),
      ],
    };
    const lead = runWidget(widget({ metric: 'leadTime' }), odd, '2026-11-01', '2026-11-30', NOW);
    expect(lead.count).toBe(2);
    expect(runWidget(widget({ metric: 'late' }), odd, '2026-11-01', '2026-11-30', NOW).total).toBe(
      0,
    );
  });
});
