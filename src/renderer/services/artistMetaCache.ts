/**
 * 歌手元信息缓存(模块级,会话内存)
 *
 * 歌手详情页的头像/名字依赖入口 navigate 传递的 location.state,
 * 但 React Router 返回导航(back)不会保留 state —— 从专辑详情页返回歌手页时会丢头像显示 "歌手 (ID: x)"。
 * 所有进入歌手详情页的入口在 navigate 的同时写入缓存,详情页读取时 state 优先、缓存兜底。
 */

interface ArtistMeta {
  name: string;
  pic: string;
}

const artistMetaCache = new Map<string, ArtistMeta>();

export function cacheArtistMeta(id: string, meta: ArtistMeta): void {
  artistMetaCache.set(id, meta);
}

export function getCachedArtistMeta(id: string): ArtistMeta | undefined {
  return artistMetaCache.get(id);
}
