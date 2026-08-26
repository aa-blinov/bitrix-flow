// Server-only MongoDB кэш. Клиентские компоненты используют fallback in-memory.

import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'bitrix_kanban';

let client: MongoClient | null = null;
let db: Db | null = null;
let syncWorkerStarted = false;

export async function getDb(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  db = client.db(DB_NAME);

  await setupIndexes(db);
  startSyncWorker();

  return db;
}

function startSyncWorker() {
  if (syncWorkerStarted) return;
  syncWorkerStarted = true;
  const timer = setInterval(() => {
    void import('./task-mirror')
      .then(({ processTaskMirrorJobs }) => processTaskMirrorJobs(undefined, 20))
      .catch((error) => console.error('Task mirror worker failed', error));
  }, 15_000);
  timer.unref();
}

async function setupIndexes(database: Db) {
  try {
    await database.collection('cache').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await database.collection('projects').createIndex({ id: 1 }, { unique: true });
    await database.collection('stages').createIndex({ entityId: 1, stageId: 1 }, { unique: true });
    await database.collection('tasks').createIndex({ id: 1 }, { unique: true });
    await database.collection('tasks').createIndex({ groupId: 1 });
    await database.collection('comments').createIndex({ taskId: 1, id: 1 }, { unique: true });
    await database.collection('time_entries').createIndex({ taskId: 1, id: 1 }, { unique: true });
    await database.collection('task_mirror').createIndex({ member_id: 1, id: 1 }, { unique: true });
    await database.collection('task_mirror').createIndex({ member_id: 1, project_id: 1 });
    await database
      .collection('task_sync_jobs')
      .createIndex({ member_id: 1, status: 1, next_run_at: 1 });
    await database.collection('sessions').createIndex({ session_hash: 1 }, { unique: true });
    await database.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } catch {}
}

export interface CachedItem<T> {
  key: string;
  data: T;
  expiresAt: Date;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const database = await getDb();
    const item = await database.collection<CachedItem<T>>('cache').findOne({ key });
    if (!item) return null;
    if (item.expiresAt < new Date()) return null;
    return item.data;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
  try {
    const database = await getDb();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await database
      .collection<CachedItem<T>>('cache')
      .replaceOne({ key }, { key, data, expiresAt }, { upsert: true });
  } catch {}
}

export async function cacheInvalidate(key: string): Promise<void> {
  try {
    const database = await getDb();
    await database.collection('cache').deleteOne({ key });
  } catch {}
}

export async function cacheInvalidateByPrefix(prefix: string): Promise<void> {
  try {
    const database = await getDb();
    await database.collection('cache').deleteMany({ key: { $regex: `^${prefix}` } });
  } catch {}
}

export async function stagesCacheGet(entityId: string): Promise<any[] | null> {
  try {
    const database = await getDb();
    const docs = await database.collection('stages').find({ entityId }).toArray();
    return docs.length > 0 ? docs.map((d) => d.data) : null;
  } catch {
    return null;
  }
}

export async function stagesCacheSet(entityId: string, stages: any[]): Promise<void> {
  try {
    const database = await getDb();
    await database.collection('stages').deleteMany({ entityId });
    if (stages.length > 0) {
      await database
        .collection('stages')
        .insertMany(
          stages.map((data) => ({ entityId, stageId: data.ID, data, cachedAt: new Date() })),
        );
    }
  } catch {}
}

export async function tasksCacheGet(groupId: string): Promise<any[] | null> {
  try {
    const database = await getDb();
    const docs = await database.collection('tasks').find({ groupId }).toArray();
    return docs.length > 0 ? docs.map((d) => d.data) : null;
  } catch {
    return null;
  }
}

export async function tasksCacheSet(groupId: string, tasks: any[]): Promise<void> {
  try {
    const database = await getDb();
    await database.collection('tasks').deleteMany({ groupId });
    if (tasks.length > 0) {
      await database
        .collection('tasks')
        .insertMany(tasks.map((data) => ({ groupId, id: data.id, data, cachedAt: new Date() })));
    }
  } catch {}
}

export async function taskInvalidate(taskId: string): Promise<void> {
  try {
    const database = await getDb();
    await database.collection('tasks').deleteOne({ id: taskId });
    await database.collection('comments').deleteMany({ taskId });
    await database.collection('time_entries').deleteMany({ taskId });
  } catch {}
}
