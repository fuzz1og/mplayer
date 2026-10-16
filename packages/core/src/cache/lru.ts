/**
 * LRU 原语 —— `Map` 的迭代顺序即插入顺序，因此「命中/覆盖写时把键挪到队尾 +超限从队首淘汰」就是一
 * 套完整 LRU。
 */
export function touchLru<K, V>(map: Map<K, V>, key: K): void {
  const value = map.get(key)
  if (value === undefined) return
  map.delete(key)
  map.set(key, value)
}

/** 超限时从队首（最久未用）淘汰；`capacity <= 0` 表示不限制。 */
export function evictLruOverflow<K, V>(map: Map<K, V>, capacity: number): void {
  if (capacity <= 0) return
  while (map.size > capacity) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}
