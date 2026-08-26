// Server-side in-memory кэш для Bitrix24 API (без dedup - может зависать)
const cache = new Map<string, { data: any; expires: number }>();
const pendingRequests = new Map<string, Promise<unknown>>();

const DEFAULT_TTL = 30 * 1000;

export async function serverCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = DEFAULT_TTL,
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }

  const pending = pendingRequests.get(key);
  if (pending) return pending as Promise<T>;

  const request = fetcher()
    .then((data) => {
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
