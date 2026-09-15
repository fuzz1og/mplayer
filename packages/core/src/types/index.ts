// migu 说明：旧「摄取端点无 migu 数据源（实测最慢且永远空）」限制仅适用自建 API
// 路径；T05 起咪咕走官方端点直连（c.musicapp.migu.cn），多源 'all' 搜索经
// searchSongsRouted → 咪咕直连客户端可用。
export type SourceKey = 'netease' | 'qq' | 'kugou' | 'kuwo' | 'migu' | 'qianqian' | 'soda' | 'local';

export type AudioTag = 'valid' | 'preview' | 'invalid';

/**
 * 可播资源值（ADR-0012）：直链 + 是否试听/不完整 + 写入时间。
 * 两端外层缓存与 core 预取缓存共用这一种形状——播放路径不得把它收窄成 string，
 * 否则预取命中的试听版会被回写成"完整版"（丢掉换源提示）。
 */
export interface PlayableResource {
  url: string;
  nonFull: boolean;
  ts: number;
}

export interface SongBase {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  sourceType: SourceKey;
}

/**
 * 榜单元数据（#332）。**仅榜单渲染用**，不参与收藏/歌单/历史的语义。
 *
 * 各源提供程度不同——实测三源公共只有「名次」（且名次本就由数组索引推导）；
 * 「上期名次 / 在榜周数」**只有 QQ 提供**（`cur_count`/`old_count`/`in_count`）。
 * 网易 `lastRank` 语义不明（实测与当前位次无对应）故**弃用**；酷狗无对应字段。
 * 消费方一律按「有则渲染、无则省略」处理——通用组件 + 可选列，不做按源分支的组件。
 */
export interface RankMeta {
  /** 当前名次（1-based）。缺省时消费方按数组索引推导。 */
  rank?: number;
  /** 上期名次；`null` = 新进榜；`undefined` = 该源不提供。 */
  prevRank?: number | null;
  /** 在榜周数；`undefined` = 该源不提供。 */
  weeks?: number | null;
}

export interface Song extends SongBase {
  url: string;
  cover: string;
  lrc: string;
  /** 榜单元数据（#332）；仅榜单条目携带，持久化时是无害的附加字段。 */
  rankMeta?: RankMeta;
  audioTag?: AudioTag;      // 搜索探测结果：无标记=未探测/正常, preview=片段, invalid=无法播放
  /** T12 试听版检测：完整时长校验判为 trial（非完整版）时置 true，驱动换元触发。 */
  nonFull?: boolean;
  /** 源站返回的风格/标签（如咪咕 tags），可选，UI 可按需展示。 */
  tags?: string[];
}

export interface Favorite {
  id?: number;
  songId: string;
  song: SongBase;
  createdAt: Date;
}

export interface PlayHistory {
  id?: number;
  songId: string;
  song: SongBase;
  playedAt: Date;
}

export interface Playlist {
  id: number;
  name: string;
  description?: string;
  cover?: string;
  songCount?: number;
  createdAt: Date;
}

export interface PlaylistSong {
  id?: number;
  playlistId: number;
  songId: string;
  order: number;
  song: Song;
}

export interface LocalFolder {
  path: string;
  name: string;
  songCount: number;
  lastScanned: Date;
}

export interface Artist {
  id: string;
  name: string;
  picUrl: string;
  alias: string[];
  trans?: string;
  albumSize: number;
  musicSize: number;
  sourceType: string;
}

export interface LocalSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  sourceType: 'local';
  filePath: string;
  /** 封面落盘绝对路径（审查修复：封面独立存 data/covers/，不再 base64 内嵌 JSON）。 */
  coverPath?: string;
  format: string;
  fileSize: number;
}

export interface SongGroup {
  key: string;
  name: string;
  artist: string;
  songs: Song[];
}

export interface DiscoverPlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  playCount: number;
  trackCount: number;
  creator: { nickname: string };
  tags: string[];
  description: string;
}

export interface Album {
  id: string;
  name: string;
  picUrl: string;
  artist: string;
  publishTime: string;
}

/** 播放模式 — 与 mobile/settingsStore.ts 对齐 */
export type PlayMode = '单曲循环' | '随机播放' | '列表循环';
