/**
 * Share one in-flight async task per key.
 */
export function shareInflight<T>(
  registry: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const existing = registry.get(key);
  if (existing) return existing;

  const task = start().finally(() => {
    // Only clear our own entry — a later task for the same key may have
    // replaced it after this one settled.
    if (registry.get(key) === task) registry.delete(key);
  });
  registry.set(key, task);
  return task;
}
