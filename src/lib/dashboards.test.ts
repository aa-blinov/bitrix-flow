import { describe, expect, it } from 'vitest';
import { runWidget, type Widget } from './dashboards';
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

    const flow = throughput(tasks, ['2026-10-26', '2026-11-02', '2026-11-09']);
    const weeks = run({ metric: 'closed', by: 'week' }).points;
    expect(weeks.slice(0, 3).map((point) => point.value)).toEqual(
      flow.tables[0].rows.map((row) => row.closed),
    );
  });

  it('разрез по проекту и фильтр по человеку', () => {
    expect(run({ metric: 'closed', by: 'project' }).points).toEqual([
      { key: '10', value: 1 },
      { key: '20', value: 1 },
    ]);
    expect(run({ metric: 'created', userId: '2' }).total).toBe(1);
  });

  it('часы только за период, класс берётся по задаче', () => {
    expect(run({ metric: 'hours' }).total).toBe(5);
    expect(run({ metric: 'hours', by: 'class' }).points).toEqual([
      { key: 'commercial', value: 3 },
      { key: 'unassigned', value: 2 },
    ]);
    expect(run({ metric: 'hours', by: 'month' }).points).toEqual([{ key: '2026-11', value: 5 }]);
  });

  it('медиана пустой недели это нет данных, а не ноль', () => {
    const points = run({ metric: 'leadTime', by: 'week' }).points;
    expect(points[0]).toEqual({ key: '2026-10-26', value: null });
    expect(points.find((point) => point.key === '2026-11-02')?.value).toBe(3);
  });

  it('разрез, которого у метрики нет, превращается в итог', () => {
    expect(run({ metric: 'open', by: 'week' })).toEqual({ total: 1, points: [] });
  });
});
