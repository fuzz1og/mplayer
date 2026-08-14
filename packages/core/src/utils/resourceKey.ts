/**
 * 资源 URL 归一化 key。
 *
 * 上游（api.php 302 端点）每次搜索返回的 URL 都带不同的签名参数：
 * - `t` / `timestamp`：时间戳，每次搜索都变
 * - `sign`：会话签名（get=url / get=pic 端点），每次搜索重新生成
 * - `play_auth`：soda 播放鉴权 token
 *
 * 这些参数变化不代表资源本身变化（同一首歌/同一张封面 = 同一资源）。
 * 比较资源是否变化（封面/歌词/音频 URL 是否该刷新）时必须忽略它们，
 * 否则每次搜索/懒刷新都会误判"资源变了"→ 替换 URL → 图片/音频重载
 * （迷你播放栏/播放器封面反复闪烁）。
 *
 * 与音频链路同一套语义：现有 URL 不主动换，只有"失效"（加载失败）才
 * 走 fresh 重试；归一化只用于判断"是否是同一资源"，渲染仍用原 URL
 * （签名参数是请求必需的，不能去掉）。
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
