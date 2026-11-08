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

/**
 * Класс с учётом предков: часы часто списывают в подзадачи, а тег ставят на родителя.
 * Свой тег задачи важнее родительского, конфликт на задаче тоже не перекрывается.
 */
export function resolveWithParents(
  taskId: string,
  tagsOf: (id: string) => string[] | undefined,
  parentOf: (id: string) => string,
): { hourClass: HourClassOrUnassigned; conflict: boolean; inherited: boolean } {
  const seen = new Set<string>();
  for (let id = taskId; id && id !== '0' && !seen.has(id); id = parentOf(id)) {
    seen.add(id);
    const result = resolveHourClass(tagsOf(id) || []);
    if (result.hourClass !== UNASSIGNED || result.conflict)
      return { ...result, inherited: id !== taskId };
  }
  return { hourClass: UNASSIGNED, conflict: false, inherited: false };
}
