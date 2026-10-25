// Недельная сводка руководителю прямо в чат Битрикса. Почты и Telegram в проекте нет,
// а сообщение в Битриксе доходит без новых сервисов и ключей: приложение уже ходит в
// портал от имени владельца токена. Выключено, пока не задан DIGEST_DIALOG_ID.

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

// Сводка уходит во все включённые каналы (см. digest-delivery.ts). Чат Битрикса единственный
// канал, которому нужен токен портала, поэтому он замыкает memberId.
export function configuredChannels(memberId: string) {
  return digestChannels(process.env, async (text) => {
    await bx24OAuth(memberId, 'im.message.add', {
      DIALOG_ID: process.env.DIGEST_DIALOG_ID,
      MESSAGE: text,
    });
  });
}

export function digestEnabled() {
  return configuredChannels('').length > 0;
}

export async function sendDigest() {
  const memberId = await getProtectedMemberId();
  if (!memberId) throw new Error('NO_TOKEN');
  const text = buildDigest(await collectDigest(memberId));
  const results = await deliverDigest(configuredChannels(memberId), text);
  return { text, results };
}

// Ключ «год-неделя по понедельнику»: одна сводка в неделю, даже если сервер перезапустится
// в назначенный час.
function weekKey(now: Date) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function shouldSendDigest(now: Date, weekday: number, hour: number) {
  return now.getDay() === weekday && now.getHours() >= hour;
}

export function startDigest() {
  if (!digestEnabled() || process.env.MOCK_B24 === '1') return;
  // 1 = понедельник. Час и день по часовому поясу сервера (TZ в окружении контейнера).
  const weekday = Number(process.env.DIGEST_WEEKDAY ?? 1);
  const hour = Number(process.env.DIGEST_HOUR ?? 9);
  const tick = async () => {
    const now = new Date();
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
  console.log(
    `[digest] включена: каналов ${configuredChannels('').length}, день ${weekday}, час ${hour}`,
  );
}
