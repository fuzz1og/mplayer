/**
 * 为什么单点：两个磁盘后端都要按类型分目录，而桌面与移动端此前各写了一份判定，且**都是错的**——写
 * 的是 `key.startsWith('json:')`，对 `:json:…` 永远不匹配，于是 JSON 缓存全部落进 `bin/`（桌面已修
 * 并留下注释，移动端漏修，#410）。
 */
export function cacheKeyType(key: string): 'json' | 'bin' {
  return key.split(':', 2)[1] === 'json' ? 'json' : 'bin'
}
