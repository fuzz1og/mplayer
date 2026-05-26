const instances = new Map<string, unknown>();

export function singleton<T>(key: string, factory: () => T): T {
  if (!instances.has(key)) {
    instances.set(key, factory());
  }
  return instances.get(key) as T;
}
