// In-memory кэш для API ответов
const cache = new Map<string, { data: any; timestamp: number }>();

const DEFAULT_TTL = 60 * 1000; // 60 секунд

export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = DEFAULT_TTL,
): Promise<T> {
  const cachedItem = cache.get(key);

  if (cachedItem && Date.now() - cachedItem.timestamp < ttl) {
    return cachedItem.data as T;
  }

  const data = await fetcher();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

export function invalidateCache(key?: string) {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

export function invalidateByPrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
