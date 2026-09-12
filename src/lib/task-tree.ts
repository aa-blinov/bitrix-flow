// Раскладка списка задач деревом: найденные задачи идут корнями, недостающие
// родители подтягиваются из общего набора, дети встают под своим родителем.
// Используется группировкой «Иерархия задач» и на клиентском, и на серверном
// наборе — поэтому живёт отдельно от компонента.

export type TreeTask = { id: string; parentId?: string };

export function orderTasksAsTree<T extends TreeTask>(matching: T[], known: Iterable<T>): T[] {
  const taskById = new Map<string, T>();
  for (const task of known) taskById.set(task.id, task);
  for (const task of matching) if (!taskById.has(task.id)) taskById.set(task.id, task);

  const visibleIds = new Set(matching.map((task) => task.id));
  const ranks = new Map(matching.map((task, index) => [task.id, index]));
  // Родитель найденной задачи мог не попасть в выборку: показываем его как
  // контекст, иначе подзадача осталась бы без ветки.
  for (const task of matching) {
    let parentId = task.parentId;
    const seen = new Set<string>();
    while (parentId && !visibleIds.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = taskById.get(parentId);
      if (!parent) break;
      visibleIds.add(parent.id);
      ranks.set(parent.id, Math.min(ranks.get(parent.id) ?? Infinity, ranks.get(task.id) ?? 0));
      parentId = parent.parentId;
    }
  }

  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const id of visibleIds) {
    const task = taskById.get(id);
    if (!task) continue;
    if (task.parentId && visibleIds.has(task.parentId)) {
      (children.get(task.parentId) || children.set(task.parentId, []).get(task.parentId)!).push(
        task,
      );
    } else {
      roots.push(task);
    }
  }
  const byRank = (items: T[]) =>
    items.sort(
      (left, right) => (ranks.get(left.id) ?? Infinity) - (ranks.get(right.id) ?? Infinity),
    );
  const result: T[] = [];
  const seen = new Set<string>();
  const walk = (task: T) => {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    result.push(task);
    byRank(children.get(task.id) || []).forEach(walk);
  };
  byRank(roots).forEach(walk);
  // Циклическая ссылка (задача — потомок самой себя) не оставляет корня:
  // дописываем уцелевшее, чтобы задачи не исчезали из списка.
  const orphans = [...visibleIds]
    .filter((id) => !seen.has(id))
    .map((id) => taskById.get(id))
    .filter((task): task is T => Boolean(task));
  byRank(orphans).forEach((task) => {
    seen.add(task.id);
    result.push(task);
  });
  return result;
}
