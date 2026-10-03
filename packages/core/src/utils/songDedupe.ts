import type { Song } from '../types/index.js';
import { identityKey } from './songIdentity.js';

export type DupStatus = 'duplicate' | 'nameConflict' | 'ok';

export interface DupResult {
  status: DupStatus;
  existingSong?: Song;
}

export interface FilterResult {
  ok: Song[];
  duplicates: Song[];
  conflicts: Song[];
}

/**
 * 目标歌单快照（#553）：写入编排的**入参**，不是编排内部再去读的东西。
 *
 * 「目标歌单」这条事实（已有曲目 + 容量上限）由宿主的 adapter 读出来传进来，
 * 编排据此产出每首歌的落点；宿主只留两个回调：「读目标歌单」与「同名时怎么办」。
 */
export interface PlaylistSnapshot {
  /** 目标歌单当前已有曲目（就地新建 = 空数组）。 */
  songs: readonly Song[];
  /** 容量上限（放不下的部分截断——宿主的事实，随快照一起进 interface）。 */
  capacity: number;
}

/**
 * 歌单容量上限的**唯一来源**（1000/歌单）。
 *
 * 此前字面量在四处各写一份（core 常量 / 本文件缺省 / 桌面 adapter / 移动 adapter），
 * 改一处不会传导到别处。桌面 fileStorage 的真实截断上限与本文件同源。
 */
export const DEFAULT_PLAYLIST_CAPACITY = 1000;

/** 构建目标歌单快照（capacity 缺省 = {@link DEFAULT_PLAYLIST_CAPACITY}）。 */
export function createPlaylistSnapshot(input: {
  songs: readonly Song[];
  capacity?: number;
}): PlaylistSnapshot {
  return { songs: input.songs, capacity: input.capacity ?? DEFAULT_PLAYLIST_CAPACITY };
}

/** 名称归一：空 artist 与缺 artist 等价，避免 'x|' 与 'x|null' 分裂成两类。 */
function nameKey(song: Song): string {
  return `${song.name}|${song.artist ?? ''}`;
}

/**
 * 「这手歌落进目标歌单时算哪一类」（#553）——**写入判据的唯一实现**。
 *
 * 口径（GLOSSARY「歌曲身份」：同源判同一首，跨源不建模，只靠歌名 + 歌手文本精确匹配）：
 * 1. `identityKey` 相等 → 同一首歌（同源同 rawId；裸 id 与换源前缀 id 归一），duplicate；
 * 2. 同源且 name + artist 相等 → duplicate（换源后 id 变了，但确实是同一首）；
 * 3. 异源且 name + artist 相等 → nameConflict（同一次录音的两个来源，交宿主裁决）；
 * 4. 其余 → ok。
 *
 * 两条被旧判据误判的情形由此复位：
 * - 同源同名**不同歌手**：旧判据只看 name + sourceType，会当成已存在并**直接 return**，
 *   把合法的新歌拒之门外 → 现在落到 ok；
 * - 异源同名**不同歌手**：旧判据一律报 conflict → 现在落到 ok（两首不同的歌）。
 */
export function classifySong(targetSongs: readonly Song[], newSong: Song): DupResult {
  const targetKey = identityKey(newSong);
  const sameNameArtist: Song[] = [];

  for (const existing of targetSongs) {
    if (identityKey(existing) === targetKey) {
      return { status: 'duplicate', existingSong: existing };
    }
    if (nameKey(existing) === nameKey(newSong)) {
      sameNameArtist.push(existing);
    }
  }

  const sameSource = sameNameArtist.find((s) => s.sourceType === newSong.sourceType);
  if (sameSource) return { status: 'duplicate', existingSong: sameSource };

  const crossSource = sameNameArtist.find((s) => s.sourceType !== newSong.sourceType);
  if (crossSource) return { status: 'nameConflict', existingSong: crossSource };

  return { status: 'ok' };
}

export function filterDuplicates(targetSongs: Song[], newSongs: Song[]): FilterResult {
  const result: FilterResult = { ok: [], duplicates: [], conflicts: [] };

  for (const newSong of newSongs) {
    const check = classifySong(targetSongs, newSong);
    switch (check.status) {
      case 'duplicate':
        result.duplicates.push(newSong);
        break;
      case 'nameConflict':
        result.conflicts.push(newSong);
        break;
      case 'ok':
        result.ok.push(newSong);
        break;
    }
  }

  return result;
}

// Legacy dedup function — still used by searchService and searchStore
export const dedupeSongs = (existingSongs: Song[], newSongs: Song[]): Song[] => {
  const idSet = new Set<string>();
  const nameArtistSet = new Set<string>();

  existingSongs.forEach((song) => {
    idSet.add(song.id);
    nameArtistSet.add(`${song.name}|${song.artist}`);
  });

  const uniqueNewSongs = newSongs.filter((song) => {
    const nameArtistKey = `${song.name}|${song.artist}`;
    const isDuplicateById = idSet.has(song.id);
    const isDuplicateByNameArtist = nameArtistSet.has(nameArtistKey);

    if (!isDuplicateById && !isDuplicateByNameArtist) {
      idSet.add(song.id);
      nameArtistSet.add(nameArtistKey);
      return true;
    }

    return false;
  });

  return uniqueNewSongs;
};
