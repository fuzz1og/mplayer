/**
 * 资源 URL 归一化 key。
 * 比较资源是否变化（封面/歌词/音频 URL 是否该刷新）时必须忽略它们，否则每次搜索/懒刷新都会误判"资源
 * 变了"→ 替换 URL → 图片/音频重载（迷你播放栏/播放器封面反复闪烁）。
 */
export function resourceUrlKey(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('t');
    u.searchParams.delete('timestamp');
    u.searchParams.delete('sign');
    u.searchParams.delete('play_auth');
    return u.href;
  } catch {
    return url;
  }
}
