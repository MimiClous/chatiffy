export interface CacheEntry<T> { value?: T; expiresAt?: number; request?: Promise<T> }
/** Coalesces concurrent loads; preserves stale data for one minute on provider failure. */
export async function cached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number, loader: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const existing = cache.get(key);
  if (existing?.value !== undefined && now() < (existing.expiresAt ?? 0)) return existing.value;
  if (existing?.request) return existing.request;
  const request = loader().then(value => {
    cache.set(key, { value, expiresAt: now() + ttlMs });
    return value;
  }).catch((error: unknown) => {
    if (existing?.value !== undefined) {
      cache.set(key, { value: existing.value, expiresAt: now() + 60000 });
      return existing.value;
    }
    cache.delete(key);
    throw error;
  });
  cache.set(key, { ...existing, request });
  return request;
}
