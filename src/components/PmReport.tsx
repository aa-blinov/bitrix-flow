'use client';

// Один экран на все отчёты ПМ: расчёт на сервере (src/lib/pm-reports.ts), здесь только
// подписи, форматы и фильтры. Фильтры живут в URL, как в аналитике часов: ссылкой можно
// поделиться, и обновление страницы разрез не сбрасывает.
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button } from '@/components/monos/Button';
import { DateField } from '@/components/monos/DateField';
import { Card } from '@/components/monos/Card';
import { Notice } from '@/components/monos/Notice';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { DataTable, type DataTableFeatures } from '@/components/DataTable';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { downloadCsv } from '@/lib/csv';
import { dateFormat, numberFormat, t } from '@/lib/i18n';
import { FONT } from '@/components/monos/scale';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import type { Cell, ReportRow } from '@/lib/pm-reports';
import type { ReportKind, ReportResponse } from '@/lib/pm-reports-data';
import { cn } from '@/lib/utils';
import { useKanbanStore } from '@/store/kanban';

type Kind =
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
type Column = { id: string; label: () => string; kind: Kind };
type TableMeta = {
  id: string;
  title: () => string;
  columns: Column[];
  sort: { id: string; desc: boolean };
  /** Разрезы группировки: колонки, по которым таблица сворачивается. */
  groupings?: ('project' | 'user')[];
  empty: () => string;
};
type TileMeta = { id: string; label: () => string; kind: Kind; hint?: () => string };
type Meta = {
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
const C = {
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

// Две цифры после запятой: с одной списание в 0,04 ч выглядело нулём, а сумма строк
// расходилась с плиткой.
const HOURS = numberFormat({ maximumFractionDigits: 2 });
const COUNT = numberFormat({ maximumFractionDigits: 0 });
const DAYS = numberFormat({ maximumFractionDigits: 1 });
const PERCENT = numberFormat({ style: 'percent', maximumFractionDigits: 1 });
const DATE = dateFormat({ day: '2-digit', month: '2-digit', year: '2-digit' });
const DATE_TIME = dateFormat({
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});

/**
 * Часы для показа. Меньше 0,1 ч идут минутами: 20 секунд выглядели «0 ч», а строки по
 * 0,01 ч в сумме не сходились с итогом. unit: дописать «ч» к целым часам (плитки, графики).
 */
export function formatHours(value: number, unit = true) {
  if (value > 0 && value < 0.1) {
    const minutes = Math.round(value * 60);
    return minutes < 1 ? t('<1 мин') : t('{0} мин', minutes);
  }
  return unit ? t('{0} ч', HOURS.format(value)) : HOURS.format(value);
}

/** Доля вниз до десятой процента: 79,99 % у порога 80 % не должна показываться как 80 %. */
export const formatShare = (value: number) => PERCENT.format(Math.floor(value * 1000) / 1000);
const MONTH = dateFormat({ month: '2-digit', year: 'numeric' });

const STATUS: Record<string, () => string> = {
  '1': () => t('Новая'),
  '2': () => t('Ждёт выполнения'),
  '3': () => t('В работе'),
  '4': () => t('Ждёт контроля'),
  '5': () => t('Завершена'),
  '6': () => t('Отложена'),
};
const STATE: Record<string, () => string> = {
  open: () => t('Открыта'),
  closed: () => t('Закрыта'),
  late: () => t('Закрыта с опозданием'),
  overdue: () => t('Просрочена'),
  onTime: () => t('Закрыта в срок'),
  paused: () => t('Отложена'),
  moved: () => t('Перенесён'),
  removed: () => t('Снят'),
};
const REASON: Record<string, () => string> = {
  idle: () => t('без движения'),
  overdue: () => t('просрочена'),
  noDeadline: () => t('без дедлайна'),
  noEstimate: () => t('без оценки'),
};

/** Дата портала как есть: день из строки, без сдвига в пояс браузера. */
const portalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? DATE.format(new Date(+match[1], +match[2] - 1, +match[3])) : value;
};

function formatCell(kind: Kind, value: Cell): string {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'hours') return formatHours(Number(value), false);
  if (kind === 'count') return COUNT.format(Number(value));
  if (kind === 'days') return DAYS.format(Number(value));
  if (kind === 'percent') return formatShare(Number(value));
  if (kind === 'date') return portalDate(String(value));
  // Дата и время как в строке портала, в её же поясе: по этому дню задача отбирается в
  // период, и перевод в Москву показывал закрытие 01.11 00:30 как 31.10 вне периода.
  if (kind === 'datetime') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value));
    return match
      ? `${match[3]}.${match[2]}.${match[1].slice(2)} ${match[4]}:${match[5]}`
      : portalDate(String(value));
  }
  if (kind === 'range') {
    const [start, end] = String(value).split('..');
    return end && end !== start ? `${portalDate(start)}–${portalDate(end)}` : portalDate(start);
  }
  if (kind === 'link') return '';
  if (kind === 'month') {
    const [year, month] = String(value).split('-').map(Number);
    return year && month ? MONTH.format(new Date(year, month - 1, 1)) : String(value);
  }
  if (kind === 'status') return STATUS[String(value)]?.() || String(value);
  if (kind === 'state') return STATE[String(value)]?.() || String(value);
  if (kind === 'reasons')
    return String(value)
      .split(',')
      .map((id) => REASON[id]?.() || id)
      .join(', ');
  return String(value);
}

/** Переход из строки брака в аналитику часов: тот же проект и месяц, все классы. */
const hoursHref = (row: ReportRow) =>
  `/analytics?${new URLSearchParams({
    from: String(row.from),
    to: String(row.to),
    project: String(row.projectId),
  })}`;

const taskHref = (row: ReportRow) =>
  row.projectId && row.projectId !== NO_PROJECT_ID
    ? `/projects/${row.projectId}?task=${encodeURIComponent(String(row.taskId))}`
    : `/all-tasks?task=${encodeURIComponent(String(row.taskId))}`;

const SUMMABLE: Kind[] = ['hours', 'count'];
const helper = createColumnHelper<DataTableFeatures, ReportRow>();

function ReportTableView({
  meta,
  rows,
  grouping,
  csvName,
}: {
  meta: TableMeta;
  rows: ReportRow[];
  grouping: string | null;
  csvName: string;
}) {
  const isMobile = useIsMobile();
  const columns = useMemo(
    () =>
      meta.columns.map((column) =>
        // Сортировка видит пустое как undefined, чтобы sortUndefined отправил его в конец
        // (null таблица ставила первым), а дату как момент: строки с разными смещениями
        // по тексту сортировались не по времени. Показ берёт исходное значение строки.
        helper.accessor(
          (row) => {
            const value = row[column.id];
            if (value === null || value === undefined || value === '') return undefined;
            return column.kind === 'datetime' ? Date.parse(String(value)) : (value as Cell);
          },
          {
            id: column.id,
            header: () => column.label(),
            sortUndefined: 'last',
            ...(SUMMABLE.includes(column.kind) && column.id !== 'deltaShare'
              ? {
                  aggregationFn: 'sum' as const,
                  aggregatedCell: (info: { getValue: () => unknown }) =>
                    formatCell(column.kind, Number(info.getValue()) || 0),
                }
              : column.kind === 'days' && column.id !== 'lead'
                ? // Дни не складываются: сумма просрочек по проекту ничего не значит,
                  // а самая старая задача группы значит. Длительность до закрытия не
                  // сворачивается: максимум под ней читался как типичный срок.
                  {
                    aggregationFn: 'max' as const,
                    aggregatedCell: (info: { getValue: () => unknown }) => {
                      const value = info.getValue();
                      return value === undefined || value === null
                        ? ''
                        : t('макс. {0}', formatCell(column.kind, Number(value)));
                    },
                  }
                : // Иначе таблица складывает любое число, и доли превращались в 300 %.
                  { aggregatedCell: () => null }),
            cell: (info) => {
              const value = info.row.original[column.id] as Cell;
              if (info.row.getIsGrouped()) return formatCell(column.kind, value);
              if (column.kind === 'task')
                return (
                  <Link
                    prefetch={false}
                    className="hover:underline"
                    href={taskHref(info.row.original)}
                  >
                    {String(value)}
                  </Link>
                );
              if (column.kind === 'link')
                return (
                  <Link
                    prefetch={false}
                    className="text-ink underline"
                    href={hoursHref(info.row.original)}
                  >
                    {t('Открыть')}
                  </Link>
                );
              // Причины короткие: каждая своей строкой без переноса. Через запятую в узкой
              // колонке они рвались посередине и раздували строку в пять этажей.
              if (column.kind === 'reasons')
                return (
                  <span className="flex flex-col whitespace-nowrap">
                    {formatCell(column.kind, value)
                      .split(', ')
                      .map((reason) => (
                        <span key={reason}>{reason}</span>
                      ))}
                  </span>
                );
              const text = formatCell(column.kind, value);
              const negative = column.id === 'delta' || column.id === 'deltaShare';
              return (
                <span className={cn(negative && Number(value) > 0 && 'text-danger-text')}>
                  {negative && Number(value) > 0 ? '+' : ''}
                  {text}
                </span>
              );
            },
          },
        ),
      ),
    [meta],
  );

  const csvColumns = meta.columns.filter((column) => column.kind !== 'link');
  const exportCsv = () =>
    downloadCsv(csvName, [
      csvColumns.map((column) => column.label()),
      ...rows.map((row) =>
        csvColumns.map((column) =>
          ['hours', 'count', 'days'].includes(column.kind)
            ? row[column.id]
            : formatCell(column.kind, row[column.id]),
        ),
      ),
    ]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          {meta.title()} <span className="font-normal text-ink-faint">{rows.length}</span>
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={exportCsv}
          disabled={!rows.length}
          icon={<Download size={14} strokeWidth={1.7} />}
        >
          CSV
        </Button>
      </div>
      {isMobile ? (
        <MobileRows meta={meta} rows={rows} />
      ) : (
        <DataTable
          key={grouping || 'flat'}
          caption={meta.title()}
          columns={columns}
          data={rows}
          grouping={grouping ? [grouping] : []}
          initialSorting={[meta.sort]}
          numeric={meta.columns
            .filter((column) => ['hours', 'count', 'days', 'percent'].includes(column.kind))
            .map((column) => column.id)}
          emptyLabel={meta.empty()}
          pageSize={300}
        />
      )}
    </section>
  );
}

// На телефоне таблица в восемь колонок не читается: строка становится карточкой.
const MOBILE_PAGE = 100;

function MobileRows({ meta, rows }: { meta: TableMeta; rows: ReportRow[] }) {
  const [shown, setShown] = useState(MOBILE_PAGE);
  const sorted = useMemo(() => {
    const { id, desc } = meta.sort;
    // Пустые всегда в конце, как в таблице на десктопе: задача без срока не должна
    // оттеснять ближайшие сроки за кнопку «Показать ещё».
    return [...rows].sort((a, b) => {
      const x = a[id];
      const y = b[id];
      const empty = (value: Cell | undefined) =>
        value === null || value === undefined || value === '';
      if (empty(x) || empty(y)) return Number(empty(x)) - Number(empty(y));
      const order = x! < y! ? -1 : x! > y! ? 1 : 0;
      return desc ? -order : order;
    });
  }, [rows, meta.sort]);
  if (!rows.length)
    return <p className="py-6 text-center text-xs text-ink-faint">{meta.empty()}</p>;
  const title = meta.columns.find((column) => column.kind === 'task') || meta.columns[0];
  const link = meta.columns.some((column) => column.kind === 'link');
  return (
    <>
      <ul className="space-y-2">
        {sorted.slice(0, shown).map((row, index) => (
          <li key={index} className="relative rounded-ui border border-line bg-surface p-3 text-sm">
            {title.kind === 'task' ? (
              // Ссылка растянута на всю карточку: на телефоне в название высотой 18px не попасть.
              <Link
                prefetch={false}
                className="font-medium text-ink after:absolute after:inset-0 after:rounded-ui hover:underline"
                href={taskHref(row)}
              >
                {String(row.task)}
              </Link>
            ) : (
              <p className="font-medium text-ink">{formatCell(title.kind, row[title.id])}</p>
            )}
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {meta.columns
                .filter((column) => column !== title && formatCell(column.kind, row[column.id]))
                .map((column) => (
                  <div key={column.id} className="contents">
                    <dt className="text-ink-faint">{column.label()}</dt>
                    <dd className="text-right tabular-nums text-ink-soft">
                      {formatCell(column.kind, row[column.id])}
                    </dd>
                  </div>
                ))}
            </dl>
            {link && (
              <Link
                prefetch={false}
                className="mt-2 inline-flex min-h-11 items-center text-xs text-ink underline"
                href={hoursHref(row)}
              >
                {t('Задачи в аналитике часов')}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {/* Остаток не прячется молча: число в заголовке и плитке должно быть доступно целиком. */}
      {sorted.length > shown && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2 min-h-11 w-full"
          onClick={() => setShown(shown + MOBILE_PAGE)}
        >
          {t(
            'Показать ещё {0}, осталось {1}',
            Math.min(MOBILE_PAGE, sorted.length - shown),
            sorted.length - shown,
          )}
        </Button>
      )}
    </>
  );
}

type Response = ReportResponse;

/** Человек по id: пустой и нулевой это «без ответственного», а не технический «#0». */
export const personName = (users: { id: string; name: string }[], id: string) =>
  !id || id === '0'
    ? t('Без ответственного')
    : users.find((user) => user.id === id)?.name || `#${id}`;

/**
 * Варианты фильтра проекта: активные, «Без проекта», затем архивные с пометкой. Архивный
 * проект нужен для итогового отчёта за месяц, когда проект уже закрыли.
 */
export function projectOptions(projects: { id: string; name: string; isArchived?: boolean }[]) {
  return [
    ...projects
      .filter((project) => !project.isArchived)
      .map((project) => ({ value: project.id, label: project.name })),
    { value: NO_PROJECT_ID, label: t(NO_PROJECT_NAME) },
    ...projects
      .filter((project) => project.isArchived)
      .map((project) => ({ value: project.id, label: t('{0} (архив)', project.name) })),
  ];
}

/** Недели для предупреждения: дд.мм через запятую, длинный список сокращается. */
export const weekList = (weeks: string[]) =>
  weeks.length > 4
    ? t('{0} и ещё {1}', weeks.slice(0, 3).map(portalDate).join(', '), weeks.length - 3)
    : weeks.map(portalDate).join(', ');

function PmReportView({ kind }: { kind: ReportKind }) {
  const meta = PM_REPORTS[kind];
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallback = useMemo(() => PRESETS[meta.defaultPeriod](), [meta.defaultPeriod]);
  const from = searchParams.get('from') || fallback.from;
  const to = searchParams.get('to') || fallback.to;
  const projectId = meta.noProject ? null : searchParams.get('project');
  const filter = searchParams.get('filter');
  const days = searchParams.get('days') || '14';
  const by = searchParams.get('by');

  const memberId = useKanbanStore((state) => state.memberId);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  const [report, setReport] = useState<Response | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`?${next}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    const params = new URLSearchParams({ from, to, days });
    if (projectId) params.set('project', projectId);
    setIsLoading(true);
    setError('');
    fetch(`/api/reports/${kind}?${params}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as Response;
        if (!cancelled) setReport(data);
      })
      .catch(() => !cancelled && setError(t('Не удалось построить отчёт.')))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [memberId, kind, from, to, projectId, days]);

  const projectName = useCallback(
    (id: string) =>
      id === NO_PROJECT_ID
        ? t(NO_PROJECT_NAME)
        : projects.find((project) => project.id === id)?.name || t('Проект {0}', id),
    [projects],
  );
  const userName = useCallback((id: string) => personName(users, id), [users]);
  // Имена подставляются здесь: сервер отдаёт id, а люди и проекты уже лежат в сторе.
  // Фильтр плитки оставляет строки с её ключом; таблица без таких строк скрывается.
  const tables = useMemo(
    () =>
      (report?.tables || []).map((table) => ({
        ...table,
        rows: table.rows
          .filter(
            (row) =>
              !filter ||
              String(row.filters || '')
                .split(',')
                .includes(filter),
          )
          .map((row) => ({
            ...row,
            project: row.projectId === undefined ? undefined : projectName(String(row.projectId)),
            user:
              row.userId !== undefined
                ? userName(String(row.userId))
                : row.responsibleId !== undefined
                  ? userName(String(row.responsibleId))
                  : undefined,
          })) as ReportRow[],
      })),
    [report, projectName, userName, filter],
  );

  const preset = (Object.keys(PRESETS) as Preset[]).find((key) => {
    const value = PRESETS[key]();
    return value.from === from && value.to === to;
  });
  const groupings = [...new Set(meta.tables.flatMap((table) => table.groupings || []))];
  const grouping = by && (groupings as string[]).includes(by) ? by : null;
  const coverage = report?.coverage;
  const filterTile = meta.tiles.find(
    (tile) => report?.tiles.find((item) => item.id === tile.id)?.filter === filter,
  );

  return (
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader title={meta.title()} description={meta.description()} />
      <div className="space-y-3 px-4 py-4 lg:px-6">
        <Card padding="none">
          <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
            {meta.period && (
              <>
                <SegmentedControl
                  size="sm"
                  value={preset || ''}
                  onChange={(value) => setParams(PRESETS[value as Preset]())}
                  options={[
                    { value: 'month', label: t('Этот месяц') },
                    { value: 'previous', label: t('Прошлый месяц') },
                    { value: 'quarter', label: t('Квартал') },
                    { value: 'three', label: t('3 месяца') },
                  ]}
                />
                <DateField
                  variant="boxed"
                  size="sm"
                  value={from}
                  onChange={(value) => value && setParams({ from: value })}
                  className="w-full min-w-0 sm:w-40"
                  aria-label={t('Начальная дата периода')}
                />
                <DateField
                  variant="boxed"
                  size="sm"
                  value={to}
                  onChange={(value) => value && setParams({ to: value })}
                  className="w-full min-w-0 sm:w-40"
                  aria-label={t('Конечная дата периода')}
                />
              </>
            )}
            {!meta.noProject && (
              <SelectField
                size="sm"
                variant="boxed"
                className="w-full sm:w-56"
                aria-label={t('Проект')}
                value={projectId || ''}
                onChange={(event) => setParams({ project: event.target.value || null })}
                options={[
                  {
                    value: '',
                    label: meta.needsProject ? t('Выберите проект') : t('Все проекты'),
                  },
                  ...projectOptions(projects),
                ]}
              />
            )}
            {kind === 'stale' && (
              <label className="flex items-center gap-2 text-ink-soft">
                {t('Без движения от, дн')}
                <TextField
                  type="number"
                  variant="boxed"
                  size="sm"
                  min={1}
                  value={days}
                  onChange={(event) => {
                    // Порог меньше суток сервер не примет: в поле не держим число, по
                    // которому отчёт не считается.
                    const value = Math.floor(Number(event.target.value));
                    if (value >= 1) setParams({ days: value === 14 ? null : String(value) });
                  }}
                  className="w-20"
                />
              </label>
            )}
            {groupings.length > 0 && (
              <SegmentedControl
                size="sm"
                className="sm:ml-auto max-sm:hidden"
                value={grouping || 'none'}
                onChange={(value) => setParams({ by: value === 'none' ? null : value })}
                options={[
                  { value: 'none', label: t('Списком') },
                  ...groupings.map((value) => ({
                    value,
                    label: value === 'project' ? t('По проектам') : t('По людям'),
                  })),
                ]}
              />
            )}
          </div>
        </Card>

        {meta.notes && <p className="text-xs text-ink-soft">{meta.notes()}</p>}
        {report?.emptyMirror && (
          <Notice tone="warning">
            {t('Задачи из Битрикса ещё не загружены: нули в отчёте значат «нет данных».')}
          </Notice>
        )}
        {coverage?.collectedAt && (
          <p className="text-xs text-ink-soft">
            {t(
              'Часы собраны не позже {0}: списаний, сделанных после, в отчёте может не быть.',
              DATE_TIME.format(new Date(coverage.collectedAt)),
            )}
          </p>
        )}
        {Boolean(report?.closedNoDate) && (
          <Notice tone="warning">
            {t(
              'Завершённых задач без даты закрытия: {0}. Их не отнести к периоду, в закрытые и в хвост на конец недели они не входят.',
              report?.closedNoDate,
            )}
          </Notice>
        )}
        {report?.teamIncomplete && (
          <Notice tone="warning">
            {t(
              'Часть из 8 недель до периода не собрана: человек, списывавший только тогда, может не попасть в список.',
            )}
          </Notice>
        )}
        {coverage && coverage.missingWeeks.length > 0 && (
          <Notice tone="warning">
            {t(
              'Списания за недели с {0} не собраны: часов за них в отчёте нет, это не ноль работы.',
              weekList(coverage.missingWeeks),
            )}
          </Notice>
        )}
        {coverage && coverage.partialWeeks.length > 0 && (
          <Notice tone="warning">
            {t(
              'Недели с {0} собраны не полностью: часть задач Битрикс не отдал, часы занижены.',
              weekList(coverage.partialWeeks),
            )}
          </Notice>
        )}
        {Boolean(report?.excludedUsers) && (
          <p className="text-xs text-ink-soft">
            {t('Служебные учётки из настроек ({0}) в часах не учитываются.', report?.excludedUsers)}
          </p>
        )}
        {filterTile && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>{t('Показаны задачи плитки «{0}»', filterTile.label())}</span>
            <Button variant="secondary" size="sm" onClick={() => setParams({ filter: null })}>
              {t('Показать все')}
            </Button>
          </div>
        )}

        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : meta.needsProject && !projectId ? (
          <Notice>{t('Выберите проект, чтобы построить отчёт.')}</Notice>
        ) : isLoading && !report ? (
          <LoadingState className="min-h-72 bg-transparent" />
        ) : report ? (
          <div
            // Пока считается новый период или проект, прежние цифры бледные и не нажимаются:
            // по ним легко было принять старый проект за выбранный.
            className={cn(
              'space-y-4 transition-opacity',
              isLoading && 'pointer-events-none opacity-40',
            )}
            aria-busy={isLoading}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {meta.tiles.map((tile) => {
                const value = report.tiles.find((item) => item.id === tile.id);
                const tileFilter = value?.filter;
                const content = (
                  <>
                    <p className="text-xs text-ink-soft">{tile.label()}</p>
                    <p className={cn('mt-1', FONT.metric)}>
                      {value?.value === null || value?.value === undefined
                        ? '—'
                        : tile.kind === 'hours'
                          ? formatHours(value.value)
                          : formatCell(tile.kind, value.value)}
                    </p>
                  </>
                );
                return tileFilter ? (
                  <Card
                    key={tile.id}
                    interactive
                    padding="sm"
                    selected={filter === tileFilter}
                    aria-pressed={filter === tileFilter}
                    onClick={() => setParams({ filter: filter === tileFilter ? null : tileFilter })}
                    title={tile.hint?.()}
                  >
                    {content}
                  </Card>
                ) : (
                  <Card key={tile.id} padding="sm" title={tile.hint?.()}>
                    {content}
                  </Card>
                );
              })}
            </div>
            {meta.tables.map((table) => {
              const rows = tables.find((item) => item.id === table.id)?.rows || [];
              if (filter && !rows.length) return null;
              return (
                <ReportTableView
                  key={table.id}
                  meta={table}
                  rows={rows}
                  grouping={table.groupings?.includes(grouping as 'project') ? grouping : null}
                  csvName={`${kind}-${table.id}-${from}-${to}.csv`}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PmReport({ kind }: { kind: ReportKind }) {
  // Suspense вокруг useSearchParams(): без него Next не пререндерит страницу.
  return (
    <Suspense fallback={<LoadingState />}>
      <PmReportView kind={kind} />
    </Suspense>
  );
}
