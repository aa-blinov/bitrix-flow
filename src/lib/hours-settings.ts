// Настройки учёта часов: кого не считать и какая норма. Меняет админ в интерфейсе
// (app_settings), пока там пусто, служебные учётки берутся из HOURS_EXCLUDED_USER_IDS.
import { invalidateByPrefix } from '@/lib/server-cache';
import { getDb } from './mongo';

export type HoursSettings = {
  /** Служебные учётки: их списания не входят ни в аналитику, ни в отчёты. */
  excludedUserIds: string[];
  /** Норма часов в будний день. */
  dailyHours: number;
  /** Доля нормы, ниже которой человек попадает в «ниже нормы», от 0 до 1. */
  threshold: number;
  /** Своя норма в день у людей с неполным днём, по id Битрикса. */
  perUser: Record<string, number>;
  source: 'settings' | 'env';
};

type Doc = { _id: string } & Partial<Omit<HoursSettings, 'source'>>;
const ID = 'hours';

const validHours = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 24;
const validId = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value);

/** Чистит присланное: всё неподходящее отбрасывается, а не сохраняется как есть. */
export function normalizeHoursSettings(input: unknown): Omit<HoursSettings, 'source'> | null {
  const body = (input || {}) as Record<string, unknown>;
  const dailyHours = Number(body.dailyHours);
  const threshold = Number(body.threshold);
  if (!validHours(dailyHours) || !(threshold > 0 && threshold <= 1)) return null;
  const excluded = Array.isArray(body.excludedUserIds) ? body.excludedUserIds : [];
  const perUser = Object.entries(
    body.perUser && typeof body.perUser === 'object' ? (body.perUser as object) : {},
  ).filter(([id, hours]) => validId(id) && validHours(hours));
  return {
    excludedUserIds: [...new Set(excluded.filter(validId))] as string[],
    dailyHours,
    threshold,
    perUser: Object.fromEntries(perUser) as Record<string, number>,
  };
}

export async function hoursSettings(): Promise<HoursSettings> {
  const saved = await (await getDb()).collection<Doc>('app_settings').findOne({ _id: ID });
  const fallback = {
    excludedUserIds: (process.env.HOURS_EXCLUDED_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    dailyHours: 8,
    threshold: 0.8,
    perUser: {},
  };
  const clean = saved ? normalizeHoursSettings(saved) : null;
  return clean ? { ...clean, source: 'settings' } : { ...fallback, source: 'env' };
}

export async function saveHoursSettings(settings: Omit<HoursSettings, 'source'>) {
  await (
    await getDb()
  )
    .collection<Doc>('app_settings')
    .updateOne({ _id: ID }, { $set: { ...settings, updatedAt: new Date() } }, { upsert: true });
  // Исключённые учётки и норма меняют любой отчёт часов: кэш расчётов сразу недействителен.
  invalidateByPrefix('hours:');
}
