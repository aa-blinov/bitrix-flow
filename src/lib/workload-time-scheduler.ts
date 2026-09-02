import { getDb } from './mongo';

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
const SCHEDULER_HOUR_MOSCOW = 2;
let schedulerStarted = false;
let schedulerRunning = false;

function moscowNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
  };
}

function mondayFor(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

async function runNightlyRefresh() {
  if (schedulerRunning) return;
  const now = moscowNow();
  if (now.hour !== SCHEDULER_HOUR_MOSCOW) return;

  schedulerRunning = true;
  try {
    const db = await getDb();
    const run = await db.collection<any>('workload_time_scheduler').findOne({ _id: now.date });
    if (run) return;

    // Claim the date before fetching Bitrix so a container restart or a second
    // scheduler tick cannot start the same nightly refresh twice.
    const claim = await db
      .collection<any>('workload_time_scheduler')
      .updateOne(
        { _id: now.date },
        { $setOnInsert: { started_at: new Date(), status: 'running' } },
        { upsert: true },
      );
    if (!claim.upsertedCount) return;

    const { refreshWorkloadTime } = await import('./workload-time');
    const start = mondayFor(now.date);
    const end = new Date(`${start}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const members = await db.collection('user_tokens').distinct('member_id');
    for (const memberId of members) {
      await refreshWorkloadTime(String(memberId), start, end.toISOString().slice(0, 10));
    }
    await db
      .collection<any>('workload_time_scheduler')
      .updateOne({ _id: now.date }, { $set: { status: 'completed', finished_at: new Date() } });
  } catch (error) {
    console.error('[workload-time-scheduler]', error);
    const now = moscowNow();
    await (
      await getDb()
    )
      .collection<any>('workload_time_scheduler')
      .updateOne(
        { _id: now.date },
        { $set: { status: 'failed', finished_at: new Date(), error: String(error) } },
        { upsert: true },
      );
  } finally {
    schedulerRunning = false;
  }
}

export function startWorkloadTimeScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const timer = setInterval(() => void runNightlyRefresh(), SCHEDULER_INTERVAL_MS);
  timer.unref();
  void runNightlyRefresh();
}
