import type { Song, SourceKey } from '../types/index.js';

/** 可搜索导入的音乐源（local 本地文件无搜索能力，排除） */
export type ImportSource = Exclude<SourceKey, 'local'>;

/** 歌单链接类型识别结果 */
export interface PlaylistUrlInfo {
  type: 'netease' | 'netease-short' | 'qq';
  id?: string;
  url?: string;
}

/**
 * 识别歌单分享链接来源（网易云/短链/QQ 音乐）。
 * 无法识别的链接返回 null。
 */
export function parsePlaylistUrl(url: string): PlaylistUrlInfo | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmedUrl = url.trim();

  // Full NetEase URL: https://music.163.com/#/playlist?id=xxx or https://music.163.com/playlist?id=xxx
  // 必须匹配 /playlist 路径：song/album/artist 链接同样带 id=，不校验路径会导入错歌单
  const neteaseMatch = trimmedUrl.match(/music\.163\.com.*\/playlist[^?\s]*[?&]id=(\d+)/);
  if (neteaseMatch) {
    return { type: 'netease', id: neteaseMatch[1] };
  }

  // Short link: http://163cn.tv/xxx or https://163cn.tv/xxx
  const shortMatch = trimmedUrl.match(/(?:https?:\/\/)?163cn\.tv\/\w+/);
  if (shortMatch) {
    return { type: 'netease-short', url: trimmedUrl };
  }

  // QQ Music URL: https://c6.y.qq.com/base/fcgi-bin/u?__=xxx or similar
  const qqMatch = trimmedUrl.match(/(?:https?:\/\/)?(?:c\d+\.y\.qq\.com|y\.qq\.com).*[?&]__=[^&]+/);
  if (qqMatch) {
    return { type: 'qq', url: trimmedUrl };
  }

  return null;
}

export interface ProgressState {
  total: number;
  found: number;
  skipped: number;
  failed: number;
  currentLine: string;
  currentSource: string;
  statuses: { line: string; status: 'pending' | 'searching' | 'found' | 'skipped' | 'failed'; source?: string }[];
}

export interface ImportResult {
  successes: { line: string; song: Song; source: string }[];
  failures: { line: string; reason: string }[];
  skips: { line: string; reason: string }[];
}

/** 链接导入编排的外部依赖（两端各自注入：桌面走 IPC，mobile 走本地 store/API） */
export interface PlaylistImportDeps {
  /** 把歌曲加入目标歌单 */
  addSong: (playlistId: string | number, song: Song) => Promise<void>;
}

/**
 * 链接导入（解析后已拿到的歌曲列表）：按用户勾选 + 去重后逐个加入歌单。
 * 歌曲自带来源 ID，地址播放时由播放链路路由解析，导入阶段不需要搜索。
 */
export async function importFromLink(
  playlistId: string | number,
  songs: Song[],
  selectedSongIds: Set<string>,
  existingSongs: Song[],
  deps: PlaylistImportDeps,
  onProgress: (state: ProgressState) => void
): Promise<ImportResult> {
  const successes: ImportResult['successes'] = [];
  const failures: ImportResult['failures'] = [];
  const skips: ImportResult['skips'] = [];

  // 初始化进度状态
  const statuses: ProgressState['statuses'] = [];
  const updateProgress = (partial: Partial<ProgressState> = {}) => {
    onProgress({
      total: selectedSongIds.size,
      found: successes.length,
      skipped: skips.length,
      failed: failures.length,
      currentLine: '',
      currentSource: '',
      statuses: [...statuses],
      ...partial,
    });
  };

  // 筛选用户选择的歌曲
  const selectedSongs = songs.filter(song => selectedSongIds.has(song.id));

  if (selectedSongs.length === 0) {
    updateProgress();
    return { successes, failures, skips };
  }

  // 检查重复歌曲
  const existingKeys = new Set(existingSongs.map(s => `${s.name}|${s.artist || ''}`));
  const toImport: { song: Song; statusIndex: number }[] = [];

  for (const song of selectedSongs) {
    if (existingKeys.has(`${song.name}|${song.artist || ''}`)) {
      skips.push({ line: `${song.name} - ${song.artist}`, reason: '已在歌单中' });
      statuses.push({ line: `${song.name} - ${song.artist}`, status: 'skipped' });
    } else {
      toImport.push({ song, statusIndex: statuses.length });
      statuses.push({ line: `${song.name} - ${song.artist}`, status: 'pending' });
    }
  }

  updateProgress({ skipped: skips.length });

  // 逐个添加到歌单
  for (let i = 0; i < toImport.length; i++) {
    const { song, statusIndex } = toImport[i];
    statuses[statusIndex] = { line: `${song.name} - ${song.artist}`, status: 'searching' };
    updateProgress({ currentLine: `${song.name} - ${song.artist}` });

    try {
      await deps.addSong(playlistId, song);
      successes.push({
        line: `${song.name} - ${song.artist}`,
        song,
        source: song.sourceType || 'netease'
      });
      statuses[statusIndex] = { line: `${song.name} - ${song.artist}`, status: 'found', source: song.sourceType };
    } catch (error) {
      console.error(`添加到歌单失败: ${song.name}`, error);
      failures.push({
        line: `${song.name} - ${song.artist}`,
        reason: '添加到歌单时出错'
      });
      statuses[statusIndex] = { line: `${song.name} - ${song.artist}`, status: 'failed' };
    }

    updateProgress({ found: successes.length, failed: failures.length });
  }

  return { successes, failures, skips };
}
