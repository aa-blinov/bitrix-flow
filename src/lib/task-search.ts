// Ранжирование глобального поиска. Раньше поиск был подстрокой по названию, описанию, проекту и
// исполнителю с сортировкой по дате: запрос «api» находил «capital» в описании, а точное
// совпадение с названием тонуло среди свежих задач. Теперь слово должно начинаться с запроса
// (внутри слова допускается только название), а поля весят по-разному.
export type SearchableTask = {
  id: string;
  title: string;
  description: string;
  groupName: string;
  responsibleName: string;
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 8);
}

const wordStart = (token: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(token)}`, 'iu');

/** 0 значит «не подходит»: каждое слово запроса должно найтись хотя бы в одном поле. */
export function scoreTask(task: SearchableTask, query: string): number {
  const tokens = searchTokens(query);
  if (!tokens.length) return 0;
  const phrase = tokens.join(' ');
  const title = (task.title || '').toLowerCase();
  let score = 0;

  if (tokens.length === 1 && /^\d+$/.test(tokens[0]) && String(task.id) === tokens[0]) return 1000;

  for (const token of tokens) {
    const matcher = wordStart(token);
    let best = 0;
    if (String(task.id) === token) best = 50;
    if (matcher.test(title)) best = Math.max(best, 20);
    else if (title.includes(token)) best = Math.max(best, 8);
    if (matcher.test(task.groupName || '') || matcher.test(task.responsibleName || ''))
      best = Math.max(best, 6);
    if (matcher.test(task.description || '')) best = Math.max(best, 2);
    if (!best) return 0;
    score += best;
  }

  if (title === phrase) score += 100;
  else if (title.startsWith(phrase)) score += 30;
  else if (title.includes(phrase)) score += 15;
  return score;
}

/** Подходящие задачи по убыванию веса; при равном весе остаётся порядок входа (свежие выше). */
export function rankTasks<T extends SearchableTask>(tasks: T[], query: string): T[] {
  return tasks
    .map((task, index) => ({ task, index, score: scoreTask(task, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.task);
}
