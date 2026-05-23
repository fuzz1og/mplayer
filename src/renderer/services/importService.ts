import { searchService } from '@/renderer/services/searchService';
import { playlistService } from '@/renderer/services/playlistService';
import { findBestMatch } from '@/renderer/utils/songMatcher';
import { musicApi } from '@/main/api/musicApi';
import type { Song } from '@/shared/types/song';

export type SourceType = 'netease' | 'qq' | 'kugou';

export interface PlaylistUrlInfo {
  type: 'netease' | 'netease-short';
  id?: string;
  url?: string;
}

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

  return null;
}

export interface ParsedLine {
  raw: string;
  name: string;
  artist: string;
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

export async function importSongs(
  playlistId: number,
  text: string,
  sourceOrder: SourceType[],
  existingSongs: Song[],
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

  const existingNames = new Set(existingSongs.map(s => s.name));

  const toSearch: { index: number; parsed: ParsedLine }[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (existingNames.has(lines[i].name)) {
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
      batchResults = await searchService.batchSearch(keywords, source);
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

  // Add found songs to playlist
  const addedSuccesses: ImportResult['successes'] = [];
  for (const success of successes) {
    try {
      await playlistService.addSongToPlaylist(playlistId, success.song);
      addedSuccesses.push(success);
    } catch (error) {
      console.error(`添加到歌单失败: ${success.line}`, error);
      failures.push({ line: success.line, reason: '添加到歌单时出错' });
    }
  }

  return { successes: addedSuccesses, failures, skips };
}

export async function importFromLink(
  playlistId: number,
  linkUrl: string,
  selectedSongIds: Set<string>,
  existingSongs: Song[],
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

  try {
    // 调用第三方 API 获取歌单歌曲
    const allSongs = await musicApi.getPlaylistSongsFromThirdParty(linkUrl);

    if (allSongs.length === 0) {
      updateProgress();
      return { successes, failures, skips };
    }

    // 筛选用户选择的歌曲
    const selectedSongs = allSongs.filter(song => selectedSongIds.has(song.id));

    // 检查重复歌曲
    const existingNames = new Set(existingSongs.map(s => s.name));
    const toImport: Song[] = [];

    for (const song of selectedSongs) {
      if (existingNames.has(song.name)) {
        skips.push({ line: `${song.name} - ${song.artist}`, reason: '已在歌单中' });
        statuses.push({ line: `${song.name} - ${song.artist}`, status: 'skipped' });
      } else {
        toImport.push(song);
        statuses.push({ line: `${song.name} - ${song.artist}`, status: 'pending' });
      }
    }

    updateProgress({ skipped: skips.length });

    // 逐个添加到歌单
    for (let i = 0; i < toImport.length; i++) {
      const song = toImport[i];
      statuses[i] = { line: `${song.name} - ${song.artist}`, status: 'searching' };
      updateProgress({ currentLine: `${song.name} - ${song.artist}` });

      try {
        await playlistService.addSongToPlaylist(playlistId, song);
        successes.push({
          line: `${song.name} - ${song.artist}`,
          song,
          source: song.sourceType || 'netease'
        });
        statuses[i] = { line: `${song.name} - ${song.artist}`, status: 'found', source: song.sourceType };
      } catch (error) {
        console.error(`添加到歌单失败: ${song.name}`, error);
        failures.push({
          line: `${song.name} - ${song.artist}`,
          reason: '添加到歌单时出错'
        });
        statuses[i] = { line: `${song.name} - ${song.artist}`, status: 'failed' };
      }

      updateProgress({ found: successes.length, failed: failures.length });
    }
  } catch (error) {
    console.error('链接导入失败:', error);
    failures.push({
      line: linkUrl,
      reason: error instanceof Error ? error.message : '未知错误'
    });
    updateProgress({ failed: failures.length });
  }

  return { successes, failures, skips };
}
