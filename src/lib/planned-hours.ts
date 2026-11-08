// План по задачам проекта. Одна функция на сводку проектов и аналитику часов: раньше
// правило жило в роуте сводки, и второй экран посчитал бы план по-своему.

export type PlanTask = {
  id: string;
  parentId: string;
  /** Плановые трудозатраты задачи (TIME_ESTIMATE), секунды. */
  estimate: number;
  created?: string;
  deadline?: string;
};

/**
 * Свёртка плана по иерархии: если у подзадач есть оценки, они и есть декомпозиция,
 * оценка родителя не добавляется. Если у подзадач оценок нет, остаётся оценка
 * родителя. Корни берутся относительно переданного списка, поэтому ветка проекта
 * считается один раз. Расхождение родителя и суммы детей отдаём как предупреждение.
 */
export function rollupPlan(tasks: PlanTask[]) {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, PlanTask[]>();
  for (const task of tasks) {
    if (task.parentId && ids.has(task.parentId)) {
      const siblings = children.get(task.parentId) || [];
      siblings.push(task);
      children.set(task.parentId, siblings);
    }
  }

  let warnings = 0;
  let varianceSeconds = 0;
  const effective = new Map<string, number>();
  const resolve = (task: PlanTask): number => {
    const descendants = children.get(task.id) || [];
    let result = task.estimate;
    if (descendants.length > 0) {
      const childrenPlan = descendants.reduce((sum, child) => sum + resolve(child), 0);
      if (childrenPlan > 0) {
        if (task.estimate > 0 && task.estimate !== childrenPlan) {
          warnings += 1;
          varianceSeconds += Math.abs(task.estimate - childrenPlan);
        }
        result = childrenPlan;
      }
    }
    effective.set(task.id, result);
    return result;
  };

  const roots = tasks.filter((task) => !(task.parentId && ids.has(task.parentId)));
  const plannedSeconds = roots.reduce((sum, task) => sum + resolve(task), 0);
  return { plannedSeconds, warnings, varianceSeconds, roots, effective };
}

/**
 * День по часам портала. Портал отдаёт даты в своём поясе (+03:00), а контейнер живёт
 * в UTC: через Date списание в 01:30 по Москве уезжало в предыдущий день, а на стыке
 * месяцев и в предыдущий месяц. Поэтому дата берётся из строки как есть.
 */
export function portalDay(value: unknown): string {
  const text = String(value || '');
  const prefix = /^\d{4}-\d{2}-\d{2}/.exec(text);
  if (prefix) return prefix[0];
  const date = new Date(text);
  return text && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
    : '';
}
const day = portalDay;

/**
 * План за период по правилу старого PM-дашборда, чтобы цифры сходились при сверке:
 * корневая задача отдаёт весь свой план, если её окно [создание, дедлайн] пересекает
 * период. Без дедлайна окно это один день создания. План по дням не размазываем:
 * оценка в портале ставится на задачу целиком, а не на календарь.
 */
export function planForPeriod(tasks: PlanTask[], from: string, to: string): number {
  const { roots, effective } = rollupPlan(tasks);
  let seconds = 0;
  for (const task of roots) {
    const created = day(task.created);
    if (!created) continue;
    const deadline = day(task.deadline) || created;
    const start = created < deadline ? created : deadline;
    const end = created < deadline ? deadline : created;
    if (start <= to && end >= from) seconds += effective.get(task.id) || 0;
  }
  return seconds;
}
