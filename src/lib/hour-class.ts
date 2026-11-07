import { tagKey } from './task-tags';

export const HOUR_CLASSES = ['commercial', 'defect', 'internal', 'presale', 'other'] as const;
export type HourClass = (typeof HOUR_CLASSES)[number];
export const UNASSIGNED = 'unassigned';
export type HourClassOrUnassigned = HourClass | typeof UNASSIGNED;

// Тег задачи в портале -> класс. Сравнение по tagKey (без # и регистра), поэтому
// «#Брак», «брак» и штатный тег «Брак» дают одно и то же.
const TAG_CLASS: Record<string, HourClass> = {
  коммерческие: 'commercial',
  'коммерческие подтверждённые': 'commercial',
  'коммерческие подтвержденные': 'commercial',
  брак: 'defect',
  'внутренняя разработка': 'internal',
  внутр: 'internal',
  пресейл: 'presale',
  прочие: 'other',
};

export const isHourClass = (value: unknown): value is HourClass =>
  HOUR_CLASSES.includes(value as HourClass);

/**
 * Класс часа: тег задачи сильнее класса проекта. Два разных классовых тега на
 * одной задаче не угадываем, а отдаём в «нераспределено» с флагом конфликта:
 * молча выбранный первый тег спрятал бы ошибку разметки.
 */
export function resolveHourClass(
  tags: string[],
  projectClass?: string | null,
): { hourClass: HourClassOrUnassigned; conflict: boolean } {
  const found = new Set(tags.map((tag) => TAG_CLASS[tagKey(tag)]).filter(Boolean));
  if (found.size > 1) return { hourClass: UNASSIGNED, conflict: true };
  const [fromTag] = found;
  if (fromTag) return { hourClass: fromTag, conflict: false };
  if (isHourClass(projectClass)) return { hourClass: projectClass, conflict: false };
  return { hourClass: UNASSIGNED, conflict: false };
}
