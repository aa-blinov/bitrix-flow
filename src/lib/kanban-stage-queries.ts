// Сборка запросов доски: какие фазы спросить у сервера.
//
// Задачи без фазы (stageId «0») — их в портале много (в проекте «test» пять
// из восьми), и раньше доска их не показывала: колонки запрашивались по id
// известных фаз, а фазы «0» в списке фаз проекта нет. По замыслу такие
// задачи показываются в системной фазе «Новые» (см. displayedStageId в
// KanbanBoard), поэтому их надо запросить вместе с ней.

/** Псевдо-фаза для задач без фазы. */
export const NO_STAGE_ID = '0';

/** Колонка для задач, чья фаза неизвестна доске. */
export const REST_STAGES_COLUMN = '__rest__';

export interface BoardStage {
  id: string;
  systemType?: string;
}

/**
 * Фазы, которые доска запрашивает у сервера, и их подпись в колонке.
 *
 * Для системной фазы «Новые» одной колонки мало: задачи без фазы лежат в
 * Bitrix отдельно (stageId «0»), и без явного запроса они не попадают ни в
 * одну колонку. Запрашиваем их вместе с «Новыми» — тогда счётчик колонки
 * и «Показать ещё» считают один и тот же набор.
 *
 * Если системной фазы «Новые» у проекта нет, задачи без фазы запрашиваются
 * отдельной колонкой.
 */
export function boardStageQueries(
  stages: BoardStage[],
): Array<{ columnId: string; query: string }> {
  if (stages.length === 0) return [];
  const newStageId = stages.find((stage) => stage.systemType === 'NEW')?.id;
  const queries = stages.map((stage) => ({ columnId: stage.id, query: stage.id }));

  if (!newStageId) {
    // Нет системной «Новые» — задачи без фазы запрашиваем отдельно.
    queries.push({ columnId: NO_STAGE_ID, query: NO_STAGE_ID });
    return queries;
  }
  if (newStageId === NO_STAGE_ID) {
    // Фаза «0» и есть системная «Новые»: дополнительный запрос не нужен.
    return queries;
  }
  return queries.map((item) =>
    item.columnId === newStageId ? { ...item, query: `${newStageId},${NO_STAGE_ID}` } : item,
  );
}

/**
 * Фазы, которые доска уже забрала отдельными запросами.
 *
 * Остаётся запросить то, что в этот список не попало: фазы удалённых
 * колонок и проекты, у которых task.stages.get не отдаёт фазы (нет прав).
 * Без такого запроса такие задачи просто не попадали ни в одну колонку.
 */
export function coveredStageIds(stages: BoardStage[]): string[] {
  const ids = new Set<string>();
  for (const item of boardStageQueries(stages)) {
    for (const id of item.query.split(',')) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
