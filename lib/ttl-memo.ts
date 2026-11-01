/**
 * Short-lived in-isolate memo for hot reads.
 * Workers reuse an isolate, so this skips repeat JSON/RPC/D1 work.
 * It is not a global cache. Throws are not stored.
 */

export function ttlMemo<T>(ttlMs: number, maxEntries = 200) {
  const cache = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();

  return function load(key: string, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < ttlMs) return Promise.resolve(hit.value);

    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = fetcher()
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        if (cache.size > maxEntries) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  };
}
