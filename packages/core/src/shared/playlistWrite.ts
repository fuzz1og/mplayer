import type { Song } from '../types/index.js';

/**
 * 歌单写入编排（#542：**双端唯一的写入语义**）。
 *
 * 此前「往目标歌单写入一批歌」这件事散在 8 处（桌面 4 份渲染层编排 + 移动 4 处），
 * 各写各的回滚、去重与冲突口径，后果是 #493 的验收标准「失败不留空歌单」
 * **只在 2/4 处成立**——另两处 create 之后 add 抛错，新歌单留下来了但是空的。
 *
 * 深 module 的形状：interface 是「给我一批歌和一个目标」，implementation 里藏着
 * 三条决策（新建失败/写入失败怎么回滚、部分成功怎么报、同名异源怎么判），
 * 双端各留一个 adapter（桌面走 IPC、移动走 store）。
 */

/** 写入编排的外部依赖（桌面走 IpcClient，移动走 usePlaylistStore）。 */
export interface PlaylistWriteDeps {
  /** 一次性写入整批歌曲（优先；宿主不支持时可只给 addSong 走逐首）。 */
  addSongs?: (playlistId: string | number, songs: Song[]) => Promise<void>;
  /** 逐首写入（addSongs 缺失时的回落）。 */
  addSong?: (playlistId: string | number, song: Song) => Promise<void>;
  /** 新建歌单，返回新 id（就地新建场景必填）。 */
  createPlaylist?: (name: string) => Promise<string | number>;
  /** 删除歌单（回滚用；就地新建场景必填，否则无法保证「不留空歌单」）。 */
  deletePlaylist?: (playlistId: string | number) => Promise<void>;
}

/** 一次写入的结果（#542：调用方据此给文案，不再各自猜）。 */
export interface PlaylistWriteResult {
  /** 实际写入的歌曲数。 */
  added: number;
  /** 因重复/非法被跳过的歌曲数。 */
  skipped: number;
  /** 目标歌单 id（就地新建时是新建出来的那个）。 */
  playlistId: string | number;
  /** 就地上新建的歌单（true = 本次新建的，失败时会回滚）。 */
  created: boolean;
  /** 新建成功但写入失败 → 已回滚（歌单已删）；false = 未发生回滚。 */
  rolledBack: boolean;
  /** 失败原因（成功为空串）。 */
  error: string;
  /** 是否成功。 */
  ok: boolean;
}

/** 去掉批内重复的歌（按歌曲 id；id 缺失时用 名字+歌手 兜底）。 */
function dedupe(songs: readonly Song[]): { unique: Song[]; skipped: number } {
  const seen = new Set<string>();
  const unique: Song[] = [];
  for (const song of songs) {
    const key = song.id || `${song.name}|${song.artist}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(song);
  }
  return { unique, skipped: songs.length - unique.length };
}

/**
 * 往目标歌单写入一批歌（#542）。
 *
 * - 已有目标歌单：直接整批写（优先 `addSongs`，缺失则逐首 `addSong`）；
 * - 就地新建（`createName` 非空）：先建 → 再写 → **任一步失败即删除新歌单**，
 *   保证 #493 的「失败不留空歌单」在**所有**入口成立，而不是只在那两处；
 * - 批内重复会被去掉并计入 `skipped`（与宿主侧去重合流，不重复弹确认）。
 */
export async function writeSongsToPlaylist(
  params: {
    /** 目标歌单 id；`createName` 非空时忽略（走就地新建）。 */
    playlistId?: string | number;
    /** 就地新建的歌单名；非空 = 走新建分支。 */
    createName?: string;
    songs: readonly Song[];
  },
  deps: PlaylistWriteDeps,
): Promise<PlaylistWriteResult> {
  const { songs } = params;
  const fail = (error: string, extra: Partial<PlaylistWriteResult> = {}): PlaylistWriteResult => ({
    added: 0,
    skipped: 0,
    playlistId: params.playlistId ?? '',
    created: false,
    rolledBack: false,
    error,
    ok: false,
    ...extra,
  });

  if (songs.length === 0) return fail('没有可写入的歌曲');

  const { unique, skipped } = dedupe(songs);
  if (unique.length === 0) return fail('没有可写入的歌曲', { skipped });

  // ── 就地新建分支：先建，再写，失败即回滚 ──
  if (params.createName?.trim()) {
    const name = params.createName.trim();
    if (!deps.createPlaylist) return fail('宿主未提供新建歌单能力');
    let newId: string | number;
    try {
      newId = await deps.createPlaylist(name);
    } catch (e) {
      return fail(`新建歌单失败: ${(e as Error)?.message || e}`);
    }
    try {
      await writeBatch(newId, unique, deps);
      return {
        added: unique.length,
        skipped,
        playlistId: newId,
        created: true,
        rolledBack: false,
        error: '',
        ok: true,
      };
    } catch (e) {
      // #493 的核心约束：**写入失败就删掉刚建的空歌单**。
      // 删不掉也要如实上报（rolledBack=false），让调用方知道有一个空歌单残留。
      let rolledBack = false;
      try {
        await deps.deletePlaylist?.(newId);
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
      return fail(`写入失败: ${(e as Error)?.message || e}`, {
        skipped,
        playlistId: newId,
        created: true,
        rolledBack,
      });
    }
  }

  // ── 已有歌单分支 ──
  if (params.playlistId === undefined || params.playlistId === '') {
    return fail('未指定目标歌单');
  }
  try {
    await writeBatch(params.playlistId, unique, deps);
    return {
      added: unique.length,
      skipped,
      playlistId: params.playlistId,
      created: false,
      rolledBack: false,
      error: '',
      ok: true,
    };
  } catch (e) {
    return fail(`写入失败: ${(e as Error)?.message || e}`, { skipped });
  }
}

/** 实际落写：优先整批（一次持久化 + 一次渲染），缺失才逐首。 */
async function writeBatch(
  playlistId: string | number,
  songs: Song[],
  deps: PlaylistWriteDeps,
): Promise<void> {
  if (deps.addSongs) {
    await deps.addSongs(playlistId, songs);
    return;
  }
  if (!deps.addSong) throw new Error('宿主未提供写入能力');
  for (const song of songs) {
    await deps.addSong(playlistId, song);
  }
}
