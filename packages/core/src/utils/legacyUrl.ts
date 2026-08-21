/**
 * 已退役的旧会话签名端点识别（桌面/移动端共享）。
 *
 * 旧版本通过 `api.php?get=url|pic|lrc` 这类带签名参数的端点拿 url/cover/lrc，
 * 服务退役后这些地址全部失效。这类地址不能再当作"有可播放 URL"，否则刷新
 * 流程会被旧缓存/旧存储数据抢先命中，永远刷不出新信息。
 */
export function isLegacyDeadUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('api.php') && parsed.searchParams.has('get');
  } catch {
    // 非 URL 字符串直接按非死链处理，由播放层继续判断
  }
  return false;
}

/** 就地清掉对象里指向已退役端点的 url/cover/lrc；返回是否有改动。 */
export function clearLegacyDeadResources(song: {
  url?: string;
  cover?: string;
  lrc?: string;
}): boolean {
  let changed = false;
  for (const field of ['url', 'cover', 'lrc'] as const) {
    if (isLegacyDeadUrl(song[field])) {
      song[field] = '';
      changed = true;
    }
  }
  return changed;
}
