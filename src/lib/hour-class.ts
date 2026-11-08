import { tagKey } from './task-tags';

export const HOUR_CLASSES = ['commercial', 'defect', 'internal', 'presale', 'other'] as const;
export type HourClass = (typeof HOUR_CLASSES)[number];
export const UNASSIGNED = 'unassigned';
export type HourClassOrUnassigned = HourClass | typeof UNASSIGNED;

// Класс часа ставится тегом задачи, и в одном проекте бывают разные классы. Префикс
// «часы-» отделяет эти теги от рабочих: «прочее», «ошибка» и «баг» в портале уже
// заняты в другом смысле. Одно слово без пробелов нужно, чтобы тег работал и как
// #хэштег в описании: портал сам превращает его в штатный тег.
export const HOUR_CLASS_TAG: Record<HourClass, string> = {
  commercial: 'часы-коммерция',
  defect: 'часы-брак',
  internal: 'часы-внутреннее',
  presale: 'часы-пресейл',
  other: 'часы-прочее',
};

const TAG_CLASS = new Map(
  HOUR_CLASSES.map((hourClass) => [tagKey(HOUR_CLASS_TAG[hourClass]), hourClass]),
);

/**
 * Класс часа по тегам задачи; без тега часы идут в «нераспределено». Два разных
 * классовых тега на одной задаче не угадываем, а отдаём в «нераспределено» с флагом
 * конфликта: молча выбранный первый тег спрятал бы ошибку разметки.
 */
export function resolveHourClass(tags: string[]): {
  hourClass: HourClassOrUnassigned;
  conflict: boolean;
} {
  const found = new Set(tags.map((tag) => TAG_CLASS.get(tagKey(tag))).filter(Boolean));
  const [only] = found;
  if (found.size > 1) return { hourClass: UNASSIGNED, conflict: true };
  return { hourClass: only ?? UNASSIGNED, conflict: false };
}

export type HourClassSource = 'task' | 'parent' | 'project' | '';

/**
 * Класс с учётом предков и проекта. Часы часто списывают в подзадачи, а тег ставят на
 * родителя; у клиентского проекта почти всё одного класса, и размечать нужно только
 * исключения. Поэтому порядок: свой тег, тег ближайшего предка, класс проекта. Конфликт
 * на задаче или предке классом проекта не закрываем: его надо исправить разметкой.
 */
export function resolveWithParents(
  taskId: string,
  tagsOf: (id: string) => string[] | undefined,
  parentOf: (id: string) => string,
  projectClass?: HourClass | null,
): { hourClass: HourClassOrUnassigned; conflict: boolean; source: HourClassSource } {
  const seen = new Set<string>();
  for (let id = taskId; id && id !== '0' && !seen.has(id); id = parentOf(id)) {
    seen.add(id);
    const result = resolveHourClass(tagsOf(id) || []);
    if (result.conflict) return { ...result, source: '' };
    if (result.hourClass !== UNASSIGNED)
      return { ...result, source: id === taskId ? 'task' : 'parent' };
  }
  return projectClass
    ? { hourClass: projectClass, conflict: false, source: 'project' }
    : { hourClass: UNASSIGNED, conflict: false, source: '' };
}

/** Класс проекта по ключевым словам группы: тот же тег часы-*, что и у задач. */
export function projectHourClass(keywords: unknown): HourClass | null {
  const words = String(keywords || '')
    .split(',')
    .map((word) => word.trim());
  const { hourClass } = resolveHourClass(words);
  return hourClass === UNASSIGNED ? null : hourClass;
}

/** Ключевые слова проекта с новым классом: остальные слова сохраняются. */
export function withProjectClass(keywords: unknown, hourClass: HourClass | null): string {
  const keep = String(keywords || '')
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word && !TAG_CLASS.has(tagKey(word)));
  return [...keep, ...(hourClass ? [HOUR_CLASS_TAG[hourClass]] : [])].join(',');
}
