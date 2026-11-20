// Недельная сводка руководителю прямо в чат Битрикса: приложение уже ходит в портал от
// имени владельца токена. Куда и когда слать, задаёт админ в настройках (app_settings);
// пока там ничего не сохранено, действуют DIGEST_* из окружения. Без получателя выключена.

import { getProtectedMemberId } from './authorized-member';
import { deliverDigest, digestChannels } from './digest-delivery';
import { getDb } from './mongo';
import { bx24OAuth } from './oauth-client';
import { taskMirrorStages } from './task-mirror-query';

export type DigestRow = { name: string; open: number; overdue: number; noDeadline: number };

const TOP = 8;

export function buildDigest(input: {
  projects: DigestRow[];
  people: DigestRow[];
  total: { open: number; overdue: number; noDeadline: number };
  date: string;
}): string {
  const line = (row: DigestRow) =>
    `${row.name}: просрочено ${row.overdue} из ${row.open}` +
    (row.noDeadline ? `, без срока ${row.noDeadline}` : '');
  const worst = (rows: DigestRow[]) =>
    rows
      .filter((row) => row.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
      .slice(0, TOP);
  const projects = worst(input.projects);
  const people = worst(input.people);
  const out = [
    `[B]Сводка BitrixFlow на ${input.date}[/B]`,
    `Открытых задач ${input.total.open}, просрочено ${input.total.overdue}, без срока ${input.total.noDeadline}.`,
  ];
  if (projects.length) out.push('', '[B]Где больше всего просрочек[/B]', ...projects.map(line));
  if (people.length) out.push('', '[B]У кого больше всего просрочек[/B]', ...people.map(line));
  if (!projects.length && !people.length) out.push('', 'Просрочек нет.');
  return out.join('\n');
}

export async function collectDigest(memberId: string, now = new Date()) {
  const { db, stages } = await taskMirrorStages(memberId);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const rows = (await db
    .collection('task_mirror')
    .aggregate([
      ...stages,
      { $match: { rawStatus: { $nin: ['5', '6'] } } },
      {
        $project: {
          _id: 0,
          project: { $cond: [{ $in: ['$groupId', ['', '0', null]] }, 'Без проекта', '$groupName'] },
          person: {
            $cond: [
              { $in: ['$responsibleId', ['', '0', null]] },
              'Без исполнителя',
              '$responsibleName',
            ],
          },
          overdue: {
            $cond: [
              { $and: [{ $ne: ['$deadlineDate', null] }, { $lt: ['$deadlineDate', today] }] },
              1,
              0,
            ],
          },
          noDeadline: { $cond: [{ $eq: ['$deadlineDate', null] }, 1, 0] },
        },
      },
    ])
    .toArray()) as { project: string; person: string; overdue: number; noDeadline: number }[];

  const sum = (key: 'project' | 'person') => {
    const map = new Map<string, DigestRow>();
    for (const row of rows) {
      const name = String(row[key] || 'Без названия');
      const item = map.get(name) || { name, open: 0, overdue: 0, noDeadline: 0 };
      item.open += 1;
      item.overdue += row.overdue;
      item.noDeadline += row.noDeadline;
      map.set(name, item);
    }
    return [...map.values()];
  };
  return {
    projects: sum('project'),
    people: sum('person'),
    total: {
      open: rows.length,
      overdue: rows.reduce((total, row) => total + row.overdue, 0),
      noDeadline: rows.reduce((total, row) => total + row.noDeadline, 0),
    },
    date: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(now),
  };
}

export type DigestConfig = {
  /** Число это личка пользователя, chat<число> групповой чат, пусто значит не слать. */
  dialogId: string;
  /** 0 воскресенье, 1 понедельник. День и час по Москве, как остальные даты портала. */
  weekday: number;
  hour: number;
  source: 'settings' | 'env';
};

const SETTINGS_ID = 'digest';
type SettingsDoc = { _id: string; dialogId?: unknown; weekday?: unknown; hour?: unknown };
const int = (value: unknown, fallback: number, max: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : fallback;
};

export const validDialogId = (value: string) => value === '' || /^(chat)?\d+$/.test(value);

/** Настройки из базы важнее окружения: их меняют в интерфейсе без перезапуска контейнера. */
export async function digestConfig(): Promise<DigestConfig> {
  const db = await getDb();
  const saved = await db.collection<SettingsDoc>('app_settings').findOne({ _id: SETTINGS_ID });
  const raw: Omit<SettingsDoc, '_id'> = saved ?? {
    dialogId: process.env.DIGEST_DIALOG_ID,
    weekday: process.env.DIGEST_WEEKDAY,
    hour: process.env.DIGEST_HOUR,
  };
  const dialogId = String(raw.dialogId ?? '').trim();
  return {
    dialogId: validDialogId(dialogId) ? dialogId : '',
    weekday: int(raw.weekday, 1, 6),
    hour: int(raw.hour, 9, 23),
    source: saved ? 'settings' : 'env',
  };
}

export async function saveDigestConfig(config: Omit<DigestConfig, 'source'>) {
  const db = await getDb();
  await db
    .collection<SettingsDoc>('app_settings')
    .updateOne(
      { _id: SETTINGS_ID },
      { $set: { ...config, updatedAt: new Date() } },
      { upsert: true },
    );
}

// Сводка уходит во все включённые каналы (см. digest-delivery.ts). Чат Битрикса единственный
// канал, которому нужен токен портала, поэтому он замыкает memberId.
export function configuredChannels(memberId: string, dialogId: string) {
  return digestChannels({ ...process.env, DIGEST_DIALOG_ID: dialogId }, async (text) => {
    await bx24OAuth(memberId, 'im.message.add', { DIALOG_ID: dialogId, MESSAGE: text });
  });
}

export async function digestEnabled() {
  return configuredChannels('', (await digestConfig()).dialogId).length > 0;
}

export async function previewDigest() {
  const memberId = await getProtectedMemberId();
  return memberId ? buildDigest(await collectDigest(memberId)) : '';
}

export async function sendDigest() {
  const memberId = await getProtectedMemberId();
  if (!memberId) throw new Error('NO_TOKEN');
  const { dialogId } = await digestConfig();
  const text = buildDigest(await collectDigest(memberId));
  const results = await deliverDigest(configuredChannels(memberId, dialogId), text);
  return { text, results };
}

/** День недели (0 воскресенье), час и дата по Москве: пояс контейнера не важен. */
function moscow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    hour: Number(parts.hour),
    day: now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }),
  };
}

// Ключ «неделя по понедельнику»: одна сводка в неделю, даже если сервер перезапустится
// в назначенный час.
function weekKey(now: Date) {
  const { weekday, day } = moscow(now);
  const monday = new Date(`${day}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function shouldSendDigest(now: Date, weekday: number, hour: number) {
  const local = moscow(now);
  return local.weekday === weekday && local.hour >= hour;
}

export function startDigest() {
  if (process.env.MOCK_B24 === '1') return;
  // Таймер идёт всегда, а настройки читаются на каждом тике: получателя и время меняют в
  // интерфейсе, и перезапуск ради этого не нужен.
  const tick = async () => {
    const now = new Date();
    const { dialogId, weekday, hour } = await digestConfig();
    if (!configuredChannels('', dialogId).length) return;
    if (!shouldSendDigest(now, weekday, hour)) return;
    const db = await getDb();
    const key = weekKey(now);
    // Запись создаётся до отправки: два экземпляра или перезапуск не пошлют сводку дважды.
    const claimed = await db
      .collection('digest_log')
      .updateOne({ key }, { $setOnInsert: { key, at: now } }, { upsert: true });
    if (!claimed.upsertedCount) return;
    try {
      const { results } = await sendDigest();
      // Если не дошла ни в один канал, неделю не закрываем: повтор через десять минут.
      if (!results.some((result) => result.ok)) throw new Error(JSON.stringify(results));
      console.log(`[digest] сводка за неделю ${key}:`, JSON.stringify(results));
    } catch (error) {
      await db.collection('digest_log').deleteOne({ key });
      console.warn('[digest] не отправилась, повтор через 10 минут', error);
    }
  };
  setInterval(() => void tick().catch(() => {}), 10 * 60_000);
}
