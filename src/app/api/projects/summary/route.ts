import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { serverCache } from '@/lib/server-cache';
import { postBitrixJson } from '@/lib/bitrix-request';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

type RawTask = {
  id?: string;
  ID?: string;
  title?: string;
  TITLE?: string;
  status?: string;
  STATUS?: string;
  parentId?: string;
  parent_id?: string;
  PARENT_ID?: string;
  groupId?: string;
  group_id?: string;
  GROUP_ID?: string;
  timeEstimate?: string;
  TIME_ESTIMATE?: string;
  timeSpentInLogs?: string;
  TIME_SPENT_IN_LOGS?: string;
  deadline?: string;
  DEADLINE?: string;
  changedDate?: string;
  CHANGED_DATE?: string;
  createdDate?: string;
  CREATED_DATE?: string;
  commentsCount?: string;
  COMMENTS_COUNT?: string;
};

const TASK_FIELDS = [
  'ID',
  'TITLE',
  'STATUS',
  'PARENT_ID',
  'GROUP_ID',
  'TIME_ESTIMATE',
  'TIME_SPENT_IN_LOGS',
  'DEADLINE',
  'CHANGED_DATE',
  'CREATED_DATE',
  'COMMENTS_COUNT',
];

function asNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function value(task: RawTask, ...keys: (keyof RawTask)[]) {
  for (const key of keys) if (task[key] !== undefined && task[key] !== null) return task[key];
  return '';
}

function toHours(seconds: number) {
  return Math.round((seconds / 3600) * 10) / 10;
}

function calculatePlannedHours(tasks: RawTask[]) {
  const byId = new Map(tasks.map((task) => [String(value(task, 'id', 'ID')), task]));
  const children = new Map<string, RawTask[]>();
  for (const task of tasks) {
    const parentId = String(value(task, 'parentId', 'parent_id', 'PARENT_ID') || '');
    if (parentId && byId.has(parentId)) {
      const siblings = children.get(parentId) || [];
      siblings.push(task);
      children.set(parentId, siblings);
    }
  }

  let warnings = 0;
  let varianceSeconds = 0;
  const resolve = (task: RawTask): number => {
    const id = String(value(task, 'id', 'ID'));
    const own = asNumber(value(task, 'timeEstimate', 'TIME_ESTIMATE'));
    const descendants = children.get(id) || [];
    if (descendants.length === 0) return own;
    const childrenPlan = descendants.reduce((sum, child) => sum + resolve(child), 0);
    // A parent without estimated descendants remains a valid planning item.
    // Once children have estimates, they become the authoritative decomposition.
    if (childrenPlan === 0) return own;
    if (own > 0 && own !== childrenPlan) {
      warnings += 1;
      varianceSeconds += Math.abs(own - childrenPlan);
    }
    return childrenPlan;
  };

  const roots = tasks.filter(
    (task) => !byId.has(String(value(task, 'parentId', 'parent_id', 'PARENT_ID') || '')),
  );
  return {
    plannedSeconds: roots.reduce((sum, task) => sum + resolve(task), 0),
    warnings,
    varianceHours: toHours(varianceSeconds),
  };
}

function summarize(projects: any[], tasks: RawTask[]) {
  const byProject = new Map<string, RawTask[]>();
  for (const task of tasks) {
    const projectId = String(value(task, 'groupId', 'group_id', 'GROUP_ID') || '0');
    if (!byProject.has(projectId)) byProject.set(projectId, []);
    byProject.get(projectId)!.push(task);
  }

  const now = Date.now();
  return projects
    .map((project) => {
      const projectTasks = byProject.get(String(project.ID)) || [];
      const parentIds = new Set(
        projectTasks
          .map((task) => String(value(task, 'parentId', 'parent_id', 'PARENT_ID') || ''))
          .filter(Boolean),
      );
      // Parent tasks are containers: effort/progress use only executable leaves,
      // preventing a roll-up value on a parent from being counted twice.
      const leaves = projectTasks.filter((task) => !parentIds.has(String(value(task, 'id', 'ID'))));
      const activeLeaves = leaves.filter((task) => String(value(task, 'status', 'STATUS')) !== '5');
      const completed = leaves.length - activeLeaves.length;
      const overdue = activeLeaves.filter((task) => {
        const deadline = String(value(task, 'deadline', 'DEADLINE') || '');
        return deadline && new Date(deadline).getTime() < now;
      }).length;
      const noDeadline = activeLeaves.filter((task) => !value(task, 'deadline', 'DEADLINE')).length;
      const plan = calculatePlannedHours(projectTasks);
      const actual = leaves.reduce(
        (sum, task) => sum + asNumber(value(task, 'timeSpentInLogs', 'TIME_SPENT_IN_LOGS')),
        0,
      );
      const comments = projectTasks.reduce(
        (sum, task) => sum + asNumber(value(task, 'commentsCount', 'COMMENTS_COUNT')),
        0,
      );
      const changedAt = projectTasks
        .map((task) => String(value(task, 'changedDate', 'CHANGED_DATE') || ''))
        .filter(Boolean)
        .reduce<string | null>(
          (latest, date) => (!latest || new Date(date) > new Date(latest) ? date : latest),
          null,
        );

      return {
        id: String(project.ID),
        name: project.NAME || 'Без названия',
        membersCount: asNumber(project.NUMBER_OF_MEMBERS),
        taskCount: projectTasks.length,
        parentTaskCount: projectTasks.length - leaves.length,
        leafTaskCount: leaves.length,
        completed,
        inProgress: activeLeaves.length,
        overdue,
        noDeadline,
        comments,
        plannedHours: toHours(plan.plannedSeconds),
        actualHours: toHours(actual),
        varianceHours: toHours(actual - plan.plannedSeconds),
        decompositionWarnings: plan.warnings,
        decompositionVarianceHours: plan.varianceHours,
        progress: leaves.length ? Math.round((completed / leaves.length) * 100) : 0,
        changedAt,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

async function callBitrix(token: any, method: string, params: Record<string, unknown>) {
  const url = `https://${token.domain}/rest/${method}?auth=${token.access_token}`;
  const response = await postBitrixJson(url, params, true);
  if (response.error) throw new Error(`${response.error}: ${response.error_description}`);
  // For list methods Bitrix returns pagination metadata next to result, not in it.
  // Preserve it or the loop would silently stop after the first 50 tasks.
  if (method === 'tasks.task.list' && response.result && typeof response.result === 'object') {
    return { ...response.result, next: response.next, total: response.total };
  }
  return response.result;
}

async function fetchAllTasks(token: any) {
  const tasks: RawTask[] = [];
  let start = 0;
  const visited = new Set<number>();
  // Continue until Bitrix explicitly says there is no next page: history must not be truncated.
  while (!visited.has(start)) {
    visited.add(start);
    const result = await callBitrix(token, 'tasks.task.list', {
      order: { ID: 'DESC' },
      select: TASK_FIELDS,
      start,
    });
    tasks.push(...(result?.tasks || []));
    if (result?.next === undefined || result.next === null) break;
    start = Number(result.next);
  }
  return tasks;
}

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHORIZATION_REQUIRED' }, { status: 401 });

  try {
    const db = await getDb();
    const token = await db.collection('user_tokens').findOne({ member_id: memberId });
    if (!token?.access_token || !token.domain)
      return NextResponse.json({ error: 'NO_TOKEN' }, { status: 401 });
    const snapshots = db.collection('project_summary_snapshots');

    const calculate = async () => {
      const [rawProjects, tasks] = await Promise.all([
        callBitrix(token, 'sonet_group.get', {}),
        fetchAllTasks(token),
      ]);
      return { rawProjects: rawProjects || [], tasks };
    };
    const rebuild = async (bypassCache = false) => {
      const source = bypassCache
        ? await calculate()
        : await serverCache(`${memberId}:projects:summary`, calculate, 30_000);
      const projects = summarize(source.rawProjects, source.tasks);
      const calculatedAt = new Date();
      await snapshots.updateOne(
        { member_id: memberId },
        {
          $set: {
            member_id: memberId,
            projects,
            source,
            calculated_at: calculatedAt,
            stale: false,
          },
        },
        { upsert: true },
      );
      return { projects, calculatedAt };
    };
    const force = req.nextUrl.searchParams.has('refresh');
    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const dateField =
      req.nextUrl.searchParams.get('date_field') === 'created' ? 'created' : 'changed';
    const snapshot = await snapshots.findOne({ member_id: memberId });
    if (snapshot?.source && !force) {
      // Serve the last complete snapshot immediately. A task event marks it stale;
      // one deduplicated rebuild then refreshes Mongo in the background.
      if (snapshot.stale)
        void rebuild().catch((error) => console.error('Summary background rebuild failed', error));
      return NextResponse.json({
        projects:
          from || to
            ? summarize(
                snapshot.source.rawProjects || [],
                (snapshot.source.tasks || []).filter((task: RawTask) => {
                  const rawDate =
                    dateField === 'created'
                      ? value(task, 'createdDate', 'CREATED_DATE')
                      : value(task, 'changedDate', 'CHANGED_DATE');
                  const timestamp = new Date(String(rawDate)).getTime();
                  if (Number.isNaN(timestamp)) return false;
                  return (
                    (!from || timestamp >= new Date(`${from}T00:00:00`).getTime()) &&
                    (!to || timestamp <= new Date(`${to}T23:59:59.999`).getTime())
                  );
                }),
              )
            : snapshot.projects || [],
        calculatedAt: snapshot.calculated_at?.toISOString?.() || new Date().toISOString(),
        refreshing: Boolean(snapshot.stale),
      });
    }
    const result = await rebuild(force);
    return NextResponse.json({
      projects: result.projects,
      calculatedAt: result.calculatedAt.toISOString(),
      refreshing: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SUMMARY_FAILED';
    return NextResponse.json({ error: 'SUMMARY_FAILED', message }, { status: 502 });
  }
}
