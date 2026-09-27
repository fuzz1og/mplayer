/**
 * 从内核生成的缓存键里判定条目类型。
 *
 * 内核的键格式是 `${namespace}:${type}:${key}`（namespace 可为空）：
 * ``:json:song:netease:1`` / ``myns:bin:cover:abc``。所以类型段固定是
 * 冒号切分后的**第 2 段**，与 namespace 是否为空无关，也与 key 自身含不含冒号无关。
 *
 * 为什么单点：两个磁盘后端都要按类型分目录，而桌面与移动端此前各写了一份判定，
 * 且**都是错的**——写的是 `key.startsWith('json:')`，对 `:json:…` 永远不匹配，
 * 于是 JSON 缓存全部落进 `bin/`（桌面已修并留下注释，移动端漏修，#410）。
 */
export function cacheKeyType(key: string): 'json' | 'bin' {
  return key.split(':', 2)[1] === 'json' ? 'json' : 'bin'
}
