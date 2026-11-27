// Подписи и состав отчётов ПМ: заголовки, плитки, колонки, пояснения и пресеты периода.
// Отдельно от экрана (PmReport.tsx), потому что те же подписи отдаёт модели MCP: модуль с
// 'use client' серверный код импортировать не может, а копия подписей разошлась бы с экраном.
import { t } from '@/lib/i18n';
import type { ReportKind } from '@/lib/pm-reports-data';

export type Kind =
  | 'text'
  | 'task'
  | 'project'
  | 'user'
  | 'hours'
  | 'count'
  | 'days'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'range'
  | 'link'
  | 'month'
  | 'status'
  | 'state'
  | 'reasons';
export type Column = { id: string; label: () => string; kind: Kind };
export type TableMeta = {
  id: string;
  title: () => string;
  columns: Column[];
  sort: { id: string; desc: boolean };
  /** Разрезы группировки: колонки, по которым таблица сворачивается. */
  groupings?: ('project' | 'user')[];
  empty: () => string;
};
export type TileMeta = { id: string; label: () => string; kind: Kind; hint?: () => string };
export type Meta = {
  title: () => string;
  description: () => string;
  period: boolean;
  /** Отчёт без проекта не строится. */
  needsProject?: boolean;
  /** Отчёт по людям: фильтр проекта к нему не относится. */
  noProject?: boolean;
  defaultPeriod: Preset;
  tiles: TileMeta[];
  tables: TableMeta[];
  notes?: () => string;
};

// Строки отчётов одинаковы по смыслу, подписи колонок общие.
export const C = {
  project: { id: 'project', label: () => t('Проект'), kind: 'project' },
  task: { id: 'task', label: () => t('Задача'), kind: 'task' },
  user: { id: 'user', label: () => t('Исполнитель'), kind: 'user' },
  deadline: { id: 'deadline', label: () => t('Дедлайн'), kind: 'date' },
  closed: { id: 'closed', label: () => t('Закрыта'), kind: 'date' },
  status: { id: 'status', label: () => t('Статус'), kind: 'status' },
} satisfies Record<string, Column>;

export const PM_REPORTS: Record<ReportKind, Meta> = {
  'plan-fact': {
    title: () => t('План и факт'),
    description: () => t('Оценка задачи против списанных часов: где работа ушла за оценку'),
    period: true,
    defaultPeriod: 'three',
    tiles: [
      { id: 'plan', label: () => t('План'), kind: 'hours' },
      { id: 'fact', label: () => t('Факт задач с оценкой'), kind: 'hours' },
      {
        id: 'overrun',
        label: () => t('Перерасход'),
        kind: 'hours',
        hint: () => t('Сумма превышений по задачам, где факт больше плана'),
      },
      { id: 'overTasks', label: () => t('Задач с перерасходом'), kind: 'count' },
      {
        id: 'unestimated',
        label: () => t('Часы задач без оценки'),
        kind: 'hours',
        hint: () => t('Списания задач без оценки, которые не вошли в факт оценённого родителя'),
      },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Задачи с оценкой'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'state', label: () => t('Состояние'), kind: 'state' },
          { id: 'plan', label: () => t('План, ч'), kind: 'hours' },
          { id: 'fact', label: () => t('Факт, ч'), kind: 'hours' },
          { id: 'subFact', label: () => t('Из них подзадачи, ч'), kind: 'hours' },
          { id: 'delta', label: () => t('Разница, ч'), kind: 'hours' },
          { id: 'deltaShare', label: () => t('Разница, %'), kind: 'percent' },
        ],
        sort: { id: 'delta', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Задач с оценкой за период нет'),
      },
      {
        id: 'unestimated',
        title: () => t('Задачи без оценки со списаниями'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'state', label: () => t('Состояние'), kind: 'state' },
          { id: 'fact', label: () => t('Факт, ч'), kind: 'hours' },
        ],
        sort: { id: 'fact', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Все задачи со списаниями оценены'),
      },
    ],
    notes: () =>
      t(
        'Задачи, открытые сегодня, и закрытые за период; план и факт берутся за всю жизнь задачи, а не только за период. Факт это списания задачи и её подзадач без своей оценки, даже если подзадача в другом проекте; подзадача с оценкой идёт своей строкой.',
      ),
  },
  deadlines: {
    title: () => t('Сроки'),
    description: () => t('Что закрыли позже дедлайна и что просрочено сейчас'),
    period: true,
    defaultPeriod: 'month',
    tiles: [
      { id: 'closedWithDeadline', label: () => t('Закрыто с дедлайном'), kind: 'count' },
      {
        id: 'onTime',
        label: () => t('В срок'),
        kind: 'percent',
        hint: () => t('Доля среди закрытых в периоде задач с дедлайном, не позднее срока'),
      },
      { id: 'late', label: () => t('Закрыто с опозданием'), kind: 'count' },
      {
        id: 'avgLate',
        label: () => t('Медиана опоздания, дн'),
        kind: 'days',
      },
      { id: 'overdue', label: () => t('Просрочено сейчас'), kind: 'count' },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Задачи со сроком'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'state', label: () => t('Состояние'), kind: 'state' },
          { id: 'deadline', label: () => t('Дедлайн'), kind: 'datetime' },
          { id: 'closed', label: () => t('Закрыта'), kind: 'datetime' },
          { id: 'days', label: () => t('Дней сверх срока'), kind: 'days' },
        ],
        sort: { id: 'days', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Задач со сроком за период нет'),
      },
    ],
    notes: () =>
      t(
        'Опоздание: задача закрыта в периоде позже дедлайна, с точностью до минуты; неполные сутки сверх срока считаются днём. Просрочка: открытая задача с прошедшим дедлайном на сегодня, отложенные не считаются. «В срок» это доля среди закрытых с дедлайном. Нажмите на плитку, чтобы оставить в таблице только её задачи.',
      ),
  },
  throughput: {
    title: () => t('Поток задач'),
    description: () => t('Сколько задач приходит и уходит по неделям и растёт ли хвост'),
    period: true,
    defaultPeriod: 'three',
    tiles: [
      { id: 'created', label: () => t('Создано'), kind: 'count' },
      { id: 'closed', label: () => t('Закрыто'), kind: 'count' },
      {
        id: 'net',
        label: () => t('Создано минус закрыто'),
        kind: 'count',
        hint: () => t('Больше нуля: приходит больше, чем уходит'),
      },
      { id: 'lead', label: () => t('Медиана до закрытия, дн'), kind: 'days' },
    ],
    tables: [
      {
        id: 'weeks',
        title: () => t('По неделям'),
        columns: [
          { id: 'week', label: () => t('Неделя'), kind: 'range' },
          { id: 'created', label: () => t('Создано'), kind: 'count' },
          { id: 'closed', label: () => t('Закрыто'), kind: 'count' },
          { id: 'net', label: () => t('Создано минус закрыто'), kind: 'count' },
          { id: 'backlog', label: () => t('Открыто на конец недели'), kind: 'count' },
          { id: 'lead', label: () => t('Медиана до закрытия, дн'), kind: 'days' },
        ],
        sort: { id: 'week', desc: false },
        empty: () => t('Задач за период нет'),
      },
      {
        id: 'tasks',
        title: () => t('Задачи периода'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'created', label: () => t('Создана'), kind: 'date' },
          C.closed,
          { id: 'lead', label: () => t('Дней до закрытия'), kind: 'days' },
        ],
        sort: { id: 'created', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Задач за период нет'),
      },
    ],
    notes: () =>
      t(
        'Считается по текущему состоянию задач: переоткрытая задача уходит из закрытых своей недели, удалённые не учитываются. Подзадачи считаются отдельными задачами. Нажмите «Создано», «Закрыто» или медиану, чтобы увидеть задачи за числом.',
      ),
  },
  defects: {
    title: () => t('Брак'),
    description: () => t('Доля брака в оплачиваемой работе по проектам и месяцам'),
    period: true,
    defaultPeriod: 'three',
    tiles: [
      { id: 'defect', label: () => t('Брак'), kind: 'hours' },
      { id: 'commercial', label: () => t('Коммерция'), kind: 'hours' },
      {
        id: 'share',
        label: () => t('Доля брака'),
        kind: 'percent',
        hint: () => t('Брак делённый на коммерцию плюс брак'),
      },
      {
        id: 'outside',
        label: () => t('Часы других классов'),
        kind: 'hours',
        hint: () => t('Внутренние, пресейл, прочие и нераспределённые: в долю брака не входят'),
      },
    ],
    tables: [
      {
        id: 'months',
        title: () => t('Проекты по месяцам'),
        columns: [
          C.project,
          { id: 'month', label: () => t('Месяц'), kind: 'month' },
          { id: 'commercial', label: () => t('Коммерция, ч'), kind: 'hours' },
          { id: 'defect', label: () => t('Брак, ч'), kind: 'hours' },
          { id: 'share', label: () => t('Доля брака'), kind: 'percent' },
          { id: 'from', label: () => t('Задачи'), kind: 'link' },
        ],
        sort: { id: 'share', desc: true },
        groupings: ['project'],
        empty: () => t('Часов коммерции и брака за период нет'),
      },
    ],
    notes: () =>
      t(
        'Доля брака считается только по коммерции и браку, остальные классы показаны отдельной плиткой. Классы те же, что в аналитике часов: тег задачи, тег предка или класс проекта. «Открыть» в строке ведёт в аналитику часов за этот проект и месяц.',
      ),
  },
  timesheets: {
    title: () => t('Списание часов'),
    description: () => t('Кто списал меньше нормы и какие задачи закрыты без списаний'),
    period: true,
    noProject: true,
    defaultPeriod: 'month',
    tiles: [
      { id: 'fact', label: () => t('Списано'), kind: 'hours' },
      { id: 'norm', label: () => t('Норма'), kind: 'hours' },
      {
        id: 'below',
        label: () => t('Людей ниже порога нормы'),
        kind: 'count',
        hint: () =>
          t('Порог задаётся в настройках, по умолчанию 80%. Доля за весь период, а не за неделю'),
      },
      { id: 'closedNoTime', label: () => t('Закрыто без списаний'), kind: 'count' },
    ],
    tables: [
      {
        id: 'people',
        title: () => t('Люди за период'),
        columns: [
          C.user,
          { id: 'fact', label: () => t('Списано, ч'), kind: 'hours' },
          { id: 'norm', label: () => t('Норма, ч'), kind: 'hours' },
          { id: 'share', label: () => t('От нормы'), kind: 'percent' },
        ],
        sort: { id: 'share', desc: false },
        empty: () => t('Людей нет'),
      },
      {
        id: 'weeks',
        title: () => t('Люди по неделям'),
        columns: [
          C.user,
          { id: 'week', label: () => t('Неделя'), kind: 'date' },
          { id: 'fact', label: () => t('Списано, ч'), kind: 'hours' },
          { id: 'norm', label: () => t('Норма, ч'), kind: 'hours' },
          { id: 'share', label: () => t('От нормы'), kind: 'percent' },
        ],
        sort: { id: 'share', desc: false },
        groupings: ['user'],
        empty: () => t('Людей нет'),
      },
      {
        id: 'closedNoTime',
        title: () => t('Закрыты без списаний'),
        columns: [C.project, C.task, C.user, C.closed],
        sort: { id: 'closed', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Все закрытые задачи со списаниями'),
      },
    ],
    notes: () =>
      t(
        'Норма: часы в будний день из настроек (по умолчанию 8), у людей с неполным днём своя; праздники и отпуска не учтены. Люди: кто списывал часы за период или за 8 недель до него, и исполнители открытых задач. Новичку и ушедшему норма начисляется за весь период: смотрите на них отдельно.',
      ),
  },
  stale: {
    title: () => t('Зависшие задачи'),
    description: () => t('Открытые задачи без движения, просроченные, без дедлайна или оценки'),
    period: false,
    defaultPeriod: 'three',
    tiles: [
      { id: 'idle', label: () => t('Без движения'), kind: 'count' },
      { id: 'overdue', label: () => t('Просрочены'), kind: 'count' },
      { id: 'noDeadline', label: () => t('Без дедлайна'), kind: 'count' },
      { id: 'noEstimate', label: () => t('Без оценки'), kind: 'count' },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Задачи'),
        columns: [
          C.project,
          C.task,
          C.user,
          C.status,
          { id: 'activity', label: () => t('Последняя активность'), kind: 'datetime' },
          { id: 'idle', label: () => t('Дней без движения'), kind: 'days' },
          { id: 'deadline', label: () => t('Дедлайн'), kind: 'datetime' },
          { id: 'reasons', label: () => t('Причины'), kind: 'reasons' },
        ],
        sort: { id: 'idle', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Зависших задач нет'),
      },
    ],
    notes: () =>
      t(
        'Активные задачи: всё, кроме завершённых и отложенных. Движение это последняя активность в Битриксе: комментарий, смена статуса, правка. Дни без движения это полные сутки с момента активности; если активности нет, от создания. Нажмите на плитку, чтобы оставить только её задачи.',
      ),
  },
  shifts: {
    title: () => t('Переносы сроков'),
    description: () => t('Какие задачи двигают дедлайн и кто его двигает'),
    period: true,
    defaultPeriod: 'month',
    tiles: [
      { id: 'shifts', label: () => t('Переносов'), kind: 'count' },
      { id: 'tasks', label: () => t('Задач с переносом'), kind: 'count' },
      {
        id: 'repeat',
        label: () => t('Перенесены повторно'),
        kind: 'count',
        hint: () => t('Задачи, у которых срок меняли два раза и больше за период'),
      },
      { id: 'removed', label: () => t('Срок снят'), kind: 'count' },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Задачи'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'state', label: () => t('Состояние'), kind: 'state' },
          { id: 'shifts', label: () => t('Переносов'), kind: 'count' },
          { id: 'last', label: () => t('Последний перенос'), kind: 'datetime' },
          { id: 'deadline', label: () => t('Срок сейчас'), kind: 'datetime' },
        ],
        sort: { id: 'shifts', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('За период сроки не переносили'),
      },
      {
        id: 'events',
        title: () => t('Все переносы'),
        columns: [
          C.project,
          C.task,
          { id: 'user', label: () => t('Кто перенёс'), kind: 'user' },
          { id: 'at', label: () => t('Когда'), kind: 'datetime' },
          { id: 'change', label: () => t('Что сделал'), kind: 'state' },
          { id: 'deadline', label: () => t('Новый срок'), kind: 'datetime' },
        ],
        sort: { id: 'at', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('За период сроки не переносили'),
      },
    ],
    notes: () =>
      t(
        'Перенос это смена или снятие дедлайна после первой постановки, в любую сторону: портал сообщает только новый срок. История ведётся с 21.10.2026, когда приложение начало получать события портала. В таблице задач исполнитель, во всех переносах тот, кто перенёс. Нажмите на плитку, чтобы оставить только её задачи.',
      ),
  },
  untracked: {
    title: () => t('Закрыты без списаний'),
    description: () => t('Закрытые задачи, на которые не списано ни минуты'),
    period: true,
    defaultPeriod: 'month',
    tiles: [
      { id: 'untracked', label: () => t('Без списаний'), kind: 'count' },
      { id: 'closed', label: () => t('Закрыто всего'), kind: 'count' },
      {
        id: 'share',
        label: () => t('Доля без списаний'),
        kind: 'percent',
        hint: () => t('Закрытые без списаний среди всех закрытых за период'),
      },
    ],
    tables: [
      {
        id: 'tasks',
        title: () => t('Задачи'),
        columns: [
          C.project,
          C.task,
          C.user,
          { id: 'created', label: () => t('Создана'), kind: 'date' },
          C.closed,
        ],
        sort: { id: 'closed', desc: true },
        groupings: ['project', 'user'],
        empty: () => t('Все закрытые задачи со списаниями'),
      },
    ],
    notes: () =>
      t(
        'Задача закрыта в периоде, а списаний по ней нет ни за какое время. Списания подзадач родителю не засчитываются: подзадача без своих часов тоже попадёт в список.',
      ),
  },
  client: {
    title: () => t('Отчёт клиенту'),
    description: () => t('Что сделано по проекту за период, что в работе и сколько часов'),
    period: true,
    needsProject: true,
    defaultPeriod: 'previous',
    tiles: [
      { id: 'done', label: () => t('Закрыто задач'), kind: 'count' },
      { id: 'open', label: () => t('В работе'), kind: 'count' },
      { id: 'hours', label: () => t('Часов за период'), kind: 'hours' },
    ],
    tables: [
      {
        id: 'done',
        title: () => t('Сделано'),
        columns: [
          C.task,
          C.user,
          C.closed,
          { id: 'periodHours', label: () => t('Часы за период'), kind: 'hours' },
        ],
        sort: { id: 'closed', desc: false },
        empty: () => t('За период ничего не закрыто'),
      },
      {
        id: 'open',
        title: () => t('В работе'),
        columns: [
          C.task,
          C.user,
          C.status,
          C.deadline,
          { id: 'periodHours', label: () => t('Часы за период'), kind: 'hours' },
        ],
        sort: { id: 'deadline', desc: false },
        empty: () => t('Открытых задач нет'),
      },
      {
        id: 'other',
        title: () => t('Другие задачи с часами за период'),
        columns: [
          C.task,
          C.user,
          C.status,
          { id: 'periodHours', label: () => t('Часы за период'), kind: 'hours' },
        ],
        sort: { id: 'periodHours', desc: true },
        empty: () => t('Других задач с часами нет'),
      },
      {
        id: 'people',
        title: () => t('Часы по людям'),
        columns: [C.user, { id: 'hours', label: () => t('Часы'), kind: 'hours' }],
        sort: { id: 'hours', desc: true },
        empty: () => t('Списаний за период нет'),
      },
    ],
    notes: () =>
      t(
        'В работе: открытые задачи без отложенных. Часы за период это все списания по задачам проекта, «Другие задачи» это задачи со списаниями за период, которые сейчас не в «Сделано» и не в работе: закрытые вне периода, отложенные, без даты закрытия. Состав строится по текущему состоянию задач: переоткрытая задача уйдёт из «Сделано».',
      ),
  },
};

// Сегодня по часам портала: дни в отчётах считаются по Москве, и у ПМ в другом поясе
// «этот месяц» на стыке месяцев выбирал не тот месяц.
const portalToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
const monthStart = (today: string, back: number) => {
  const [year, month] = today.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1 - back, 1));
  return value.toISOString().slice(0, 10);
};
export const PRESETS = {
  month: () => {
    const today = portalToday();
    return { from: monthStart(today, 0), to: today };
  },
  previous: () => {
    const today = portalToday();
    const end = new Date(`${monthStart(today, 0)}T12:00:00Z`);
    end.setUTCDate(0);
    return { from: monthStart(today, 1), to: end.toISOString().slice(0, 10) };
  },
  quarter: () => {
    const today = portalToday();
    return { from: monthStart(today, (Number(today.slice(5, 7)) - 1) % 3), to: today };
  },
  three: () => {
    const today = portalToday();
    return { from: monthStart(today, 2), to: today };
  },
};
export type Preset = keyof typeof PRESETS;

// Значения ячеек: статус Битрикса, состояние задачи в отчёте и причины зависания.
export const STATUS: Record<string, () => string> = {
  '1': () => t('Новая'),
  '2': () => t('Ждёт выполнения'),
  '3': () => t('В работе'),
  '4': () => t('Ждёт контроля'),
  '5': () => t('Завершена'),
  '6': () => t('Отложена'),
};
export const STATE: Record<string, () => string> = {
  open: () => t('Открыта'),
  closed: () => t('Закрыта'),
  late: () => t('Закрыта с опозданием'),
  overdue: () => t('Просрочена'),
  onTime: () => t('Закрыта в срок'),
  paused: () => t('Отложена'),
  moved: () => t('Перенесён'),
  removed: () => t('Снят'),
};
export const REASON: Record<string, () => string> = {
  idle: () => t('без движения'),
  overdue: () => t('просрочена'),
  noDeadline: () => t('без дедлайна'),
  noEstimate: () => t('без оценки'),
};
