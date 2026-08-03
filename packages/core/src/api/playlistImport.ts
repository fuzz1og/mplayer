import type { Song, SourceKey } from '../types/index.js';
import { findBestMatch } from '../utils/songMatcher.js';

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
  const neteaseMatch = trimmedUrl.match(/music\.163\.com.*[?&]id=(\d+)/);
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

/** 文本粘贴的一行：歌名 + 歌手（`歌名 - 歌手` 分隔，无分隔符时整行为歌名） */
export interface ParsedLine {
  raw: string;
  name: string;
  artist: string;
}

export function parseSongList(text: string): ParsedLine[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const separatorIndex = line.lastIndexOf(' - ');
      if (separatorIndex === -1) {
        return { raw: line, name: line, artist: '' };
      }
      return {
        raw: line,
        name: line.substring(0, separatorIndex).trim(),
        artist: line.substring(separatorIndex + 3).trim(),
      };
    });
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

/** 导入编排的外部依赖（两端各自注入：桌面走 IPC，mobile 走本地 store/API） */
export interface PlaylistImportDeps {
  /** 批量搜索：keywords 与返回对象的 key 一一对应 */
  batchSearch: (keywords: string[], source: ImportSource) => Promise<Record<string, Song[]>>;
  /** 把歌曲加入目标歌单 */
  addSong: (playlistId: string | number, song: Song) => Promise<void>;
}

/**
 * 文本导入歌单：解析行 → 按源顺序批量搜索 → findBestMatch 匹配 →
 * 未匹配行流向下一个源 → 全部匹配后逐首加入歌单。
 * 进度通过 onProgress 回调（状态行数组引用会更新，需整体替换触发渲染）。
 */
export async function importSongs(
  playlistId: string | number,
  text: string,
  sourceOrder: ImportSource[],
  existingSongs: Song[],
  deps: PlaylistImportDeps,
  onProgress: (state: ProgressState) => void
): Promise<ImportResult> {
  const lines = parseSongList(text);
  const total = lines.length;

  const successes: ImportResult['successes'] = [];
  const failures: ImportResult['failures'] = [];
  const skips: ImportResult['skips'] = [];

  const statuses: ProgressState['statuses'] = lines.map(l => ({ line: l.raw, status: 'pending' as const }));

  const updateProgress = (partial: Partial<ProgressState> = {}) => {
    onProgress({
      total,
      found: successes.length,
      skipped: skips.length,
      failed: failures.length,
      currentLine: '',
      currentSource: '',
      statuses: [...statuses],
      ...partial,
    });
  };

  const existingKeys = new Set(existingSongs.map(s => `${s.name}|${s.artist || ''}`));

  const toSearch: { index: number; parsed: ParsedLine }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const key = `${lines[i].name}|${lines[i].artist || ''}`;
    if (existingKeys.has(key)) {
      skips.push({ line: lines[i].raw, reason: '已在歌单中' });
      statuses[i] = { line: lines[i].raw, status: 'skipped' };
      updateProgress({ skipped: skips.length });
    } else {
      toSearch.push({ index: i, parsed: lines[i] });
    }
  }

  const remainingLines = [...toSearch];

  for (const source of sourceOrder) {
    if (remainingLines.length === 0) break;

    const currentBatch = [...remainingLines];
    remainingLines.length = 0;

    const keywords = currentBatch.map(item => `${item.parsed.name} ${item.parsed.artist}`.trim());

    for (const item of currentBatch) {
      statuses[item.index] = { line: item.parsed.raw, status: 'searching' };
    }
    updateProgress({ currentSource: source });

    let batchResults: Record<string, Song[]>;
    try {
      batchResults = await deps.batchSearch(keywords, source);
    } catch (error) {
      console.error(`批量搜索失败 (${source}):`, error);
      for (const item of currentBatch) {
        failures.push({ line: item.parsed.raw, reason: `${source} 搜索出错` });
        statuses[item.index] = { line: item.parsed.raw, status: 'failed' };
      }
      continue;
    }

    for (let i = 0; i < currentBatch.length; i++) {
      const item = currentBatch[i];
      const keyword = keywords[i];
      const candidates = batchResults[keyword] || [];

      const match = findBestMatch(
        { name: item.parsed.name, artist: item.parsed.artist },
        candidates
      );

      if (match) {
        successes.push({
          line: item.parsed.raw,
          song: { ...match.song as Song, sourceType: source },
          source,
        });
        statuses[item.index] = { line: item.parsed.raw, status: 'found', source };
      } else {
        remainingLines.push(item);
      }
    }

    updateProgress({ found: successes.length, currentSource: '' });
  }

  for (const item of remainingLines) {
    failures.push({ line: item.parsed.raw, reason: '在所有音乐源中未找到匹配的歌曲' });
    statuses[item.index] = { line: item.parsed.raw, status: 'failed' };
  }

  updateProgress({ failed: failures.length });

  // 把找到的歌曲加入歌单（逐个，失败单独计数）
  const addedSuccesses: ImportResult['successes'] = [];
  for (const success of successes) {
    try {
      await deps.addSong(playlistId, success.song);
      addedSuccesses.push(success);
    } catch (error) {
      console.error(`添加到歌单失败: ${success.line}`, error);
      failures.push({ line: success.line, reason: '添加到歌单时出错' });
    }
  }

  return { successes: addedSuccesses, failures, skips };
}

/**
 * 链接导入（解析后已拿到的歌曲列表）：按用户勾选 + 去重后逐个加入歌单。
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
