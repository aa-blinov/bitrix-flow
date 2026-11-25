// Server-side in-memory кэш для Bitrix24 API (без dedup - может зависать)
const cache = new Map<string, { data: any; expires: number }>();
const pendingRequests = new Map<string, Promise<unknown>>();

const DEFAULT_TTL = 30 * 1000;

/**
 * staleTtl: сколько ещё после ttl отдавать прежнее значение, пока свежее грузится в фоне.
 * Справочники портала (проекты, люди) меняются редко, а их перечитывание стоит секунду:
 * с ним каждый пятый по счёту заход ждал портал целиком.
 */
export async function serverCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = DEFAULT_TTL,
  staleTtl = 0,
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }
  if (cached && cached.expires + staleTtl > Date.now()) {
    if (!pendingRequests.has(key)) void load(key, fetcher, ttl).catch(() => {});
    return cached.data as T;
  }

  const pending = pendingRequests.get(key);
  if (pending) return pending as Promise<T>;
  return load(key, fetcher, ttl);
}

function load<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T> {
  const request = fetcher()
    .then((data) => {
      // Ключи с версией данных (часы) копились бы вечно: выбрасываем протухшие.
      if (cache.size > 200)
        for (const [old, entry] of cache) if (entry.expires < Date.now()) cache.delete(old);
      cache.set(key, { data, expires: Date.now() + ttl });
      return data;
    })
    .finally(() => {
      pendingRequests.delete(key);
    });

  pendingRequests.set(key, request);
  return request;
}

export function invalidateServerCache(key: string) {
  cache.delete(key);
}

export function invalidateByPrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()).slice(0, 50),
  };
}
