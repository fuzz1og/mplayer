import type { Song } from '../types/index.js';
import {
  classifySong,
  createPlaylistSnapshot,
  type PlaylistSnapshot,
} from '../utils/songDedupe.js';
import { identityKey } from '../utils/songIdentity.js';

/**
 * 歌单写入编排（#542：**双端唯一的写入语义**；#553/#554：判据与结果契约）。
 *
 * 此前「往目标歌单写入一批歌」这件事散在 8 处（桌面 4 份渲染层编排 + 移动 4 处），
 * 各写各的回滚、去重与冲突口径，后果是 #493 的验收标准「失败不留空歌单」
 * **只在 2/4 处成立**——另两处 create 之后 add 抛错，新歌单留下来了但是空的。
 *
 * 深 module 的形状：interface 是「给我一批歌、一个目标快照、一个同名裁决」，
 * implementation 里藏着四条决策（新建失败/写入失败怎么回滚、四类落点怎么分、
 * 部分成功与容量截断怎么报、同名异源怎么问），**每首歌的落点由本模块产出**，
 * 宿主只留两个 adapter 回调：「读目标歌单」与「同名时怎么办」。
 *
 * #554：`added` 是宿主回报的**真实新增数**，不是请求数；容量截断走 `truncated`
 * 显式通道（宿主返回的新增数少于指派数即截断），不再静默。
 */

/** 目标歌单快照与构造器（#553：判据模块是唯一来源，这里转出给写入编排的调用方）。
 *  容量上限不在这里转出：它由 barrel 从 `utils/songDedupe` 直出，只留一条导出路径
 *  （#556 评审 C 续：删掉此前与 barrel 并行的 Duplicated/Middle Man 转出）。 */
export { createPlaylistSnapshot } from '../utils/songDedupe.js';
export type { PlaylistSnapshot } from '../utils/songDedupe.js';

/** 落点：批内重复/已存在命中（duplicate 或同源同名同歌手）。 */
export interface PlaylistDuplicate {
  song: Song;
  /** 判据命中时的那首既有歌。 */
  existingSong: Song;
}

/** 落点：跨源同名同歌手（同一次录音的两个来源）——交宿主裁决。 */
export interface PlaylistNameConflict {
  song: Song;
  /** 目标歌单里同名同歌手的那首既有歌。 */
  existingSong: Song;
}

/** 宿主对一批同名冲突的裁决：`add` = 照常并入；`skip` = 放弃这些歌。 */
export type NameConflictResolution = 'add' | 'skip';
/** 整批同处置（单值）或逐首处置（与 conflicts 等长的数组）。 */
export type NameConflictDecisions = NameConflictResolution | readonly NameConflictResolution[];

/**
 * 宿主向用户问「同名异源怎么处置」时的文案——**双端同一份**（#560）。
 *
 * 为什么放 core：桌面与移动是同一个动作的两种渲染（antd `Modal.confirm` / RN `Alert`），
 * 问的却必须是同一句话。各自写一份 = 迟早分叉，而分叉后没人会同时看两端。
 * 与 `OFFLINE_COPY`（core/shared/skipGuard）同一条纪律：跨端共用的用户可见文案，
 * 落点只有一个。
 *
 * 只覆盖 **adapter 的 `resolveNameConflict` 接缝**（整批一次裁决）：
 * 单曲腿的同名确认在两端各有各的交互（桌面「是否继续添加」/ 移动「替换为新版」），
 * 不在本常量范围内。
 */
export const NAME_CONFLICT_COPY = {
  title: '同名歌曲',
  confirmText: '继续添加',
  cancelText: '取消',
  /** `count` = 本批需要裁决的歌数（= `conflicts.length`）。 */
  message: (count: number) => `有 ${count} 首歌曲同名但来自不同平台，是否继续添加？`,
} as const;

/** 写入编排的外部依赖（桌面走 IpcClient，移动走 usePlaylistStore）。 */
export interface PlaylistWriteDeps {
  /**
   * **唯一的写入端口**：一次性写入整批歌曲。
   *
   * 返回**真正新增的歌数**（#554）——宿主报不出真值时给 `songs.length` 是撒谎，
   * 给 0 会让编排把写入当失败；确实不知道就让宿主自己报（而不是编一个值）。
   *
   * #556 评审 B2：此前的逐首回落腿（`addSong`）在产线上不可达——桌面与移动两个
   * adapter 都有批量能力、都必给 addSongs，只有测试 fake 才会只给 addSong。留着
   * 它等于给「只有 fake 走得到的分支」发许可证，本模块只保留唯一被走到的批量腿。
   * 缺少本端口时写入直接失败（不静默降级逐首）。
   */
  addSongs: (playlistId: string | number, songs: Song[]) => Promise<number>;
  /** 新建歌单，返回新 id（就地新建场景必填）。 */
  createPlaylist?: (name: string) => Promise<string | number>;
  /** 删除歌单（回滚用；就地新建场景必填，否则无法保证「不留空歌单」）。 */
  deletePlaylist?: (playlistId: string | number) => Promise<void>;
  /**
   * 同名异源怎么处置（宿主 adapter 的第二个回调）。
   * 一次收到**整批**冲突，宿主可以合成一个弹层问一次；返回单个决议 = 整批同处置，
   * 返回数组 = 逐首处置；'skip' 的歌被本编排丢弃。
   *
   * **不提供 = 默认并入**（#556 评审 A4）：跨源同名同歌手是同一段录音的另一个来源，
   * 默认口径是「并进去」，绝不静默丢弃。想「问用户」或「跳过」的宿主必须显式给回调
   * ——桌面两个弹窗都给了（弹同名确认）；不显式给 = 接受默认并入。
   */
  resolveNameConflict?: (
    conflicts: readonly PlaylistNameConflict[],
  ) => Promise<NameConflictDecisions> | NameConflictDecisions;
}

/** 一次写入的结果（#554：调用方据此给文案，不再各自猜）。 */
export interface PlaylistWriteResult {
  /** **宿主回报的真实新增歌数**（#554：不是请求数）。 */
  added: number;
  /** 判据命中/批内重复而跳过的歌数（不含 invalid）。 */
  skipped: number;
  /** 送进宿主却没被接纳的歌数：数据不完整 + 宿主的静默丢弃（含容量截断）。 */
  invalid: number;
  /** 同名异源、由 resolveNameConflict 裁决过的歌数。 */
  duplicateNames: number;
  /** 是否发生了容量截断（宿主接纳数 < 指派数）。 */
  truncated: boolean;
  /** 本次指派写入的曲目数（去重、去非法、去裁决跳过后）。 */
  requested: number;
  /** 目标歌单容量上限（随目标快照进来的事实）。 */
  capacity: number;
  /** 批内重复而跳过的歌曲（供调用方展示）。 */
  duplicates: PlaylistDuplicate[];
  /** 同名异源冲突（无论裁决结果，供调用方展示）。 */
  conflicts: PlaylistNameConflict[];
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

/** 歌被宿主写入路径拒收的原因（零 I/O）。 */
export type SongWriteRejection = 'missing-fields' | 'local-without-url' | null;

/**
 * 宿主写入路径会不会收下这首歌（#553 判据单点下沉；#556 评审 C：跨端唯一来源）。
 * 桌面 `fileStorage` 的写入路径（逐首与批量两处）直接消费本函数，不再各留一份
 * `validateSongData`——两端判据因此不可能分叉。不合格的歌在编排里就被摘出来，
 * 免得「建了歌单才发现一首都不合法」。
 */
export function songWriteRejection(song: Song | null | undefined): SongWriteRejection {
  if (!song || !song.id || !song.name || !song.artist) return 'missing-fields';
  if (song.sourceType === 'local' && !song.url) return 'local-without-url';
  return null;
}

/**
 * 去掉批内重复的歌：按**歌曲身份键**（identityKey，同源同 rawId；
 * 裸 id 与换源前缀 id 归一）。跨源同 id 是两首不同的歌，不会在这里被吞（#553）。
 */
function dedupeBatch(songs: readonly Song[]): { unique: Song[]; duplicates: Song[] } {
  const seen = new Set<string>();
  const unique: Song[] = [];
  const duplicates: Song[] = [];
  for (const song of songs) {
    const key = identityKey(song);
    if (seen.has(key)) {
      duplicates.push(song);
      continue;
    }
    seen.add(key);
    unique.push(song);
  }
  return { unique, duplicates };
}

/**
 * 往目标歌单写入一批歌（#542 / #553 / #554）。
 *
 * - 目标歌单快照（已有曲目 + 容量）由调用方传入；就地新建时快照是空的；
 * - 已有目标歌单：整批一次写入（唯一写入口 `addSongs`，不再有逐首回落腿）；
 * - 就地新建（`createName` 非空）：先建 → 再写 → **任一步失败即删除新歌单**，
 *   保证 #493 的「失败不留空歌单」在**所有**入口成立；
 * - 每首歌的落点由 `classifySong` 产出：duplicate 跳过、nameConflict 问宿主、其余写入；
 * - 批内重复与非法歌在编排里摘掉并各自计数，不与宿主侧的落点混淆。
 */
export async function writeSongsToPlaylist(
  params: {
    /** 目标歌单 id；`createName` 非空时忽略（走就地新建）。 */
    playlistId?: string | number;
    /** 就地新建的歌单名；非空 = 走新建分支。 */
    createName?: string;
    /** 目标歌单快照（#553）：已有曲目 + 容量。缺省 = 空歌单 + 默认容量。 */
    target?: PlaylistSnapshot;
    songs: readonly Song[];
  },
  deps: PlaylistWriteDeps,
): Promise<PlaylistWriteResult> {
  const { songs } = params;
  const target = params.target ?? createPlaylistSnapshot({ songs: [] });

  const fail = (error: string, extra: Partial<PlaylistWriteResult> = {}): PlaylistWriteResult => ({
    added: 0,
    skipped: 0,
    invalid: 0,
    duplicateNames: 0,
    truncated: false,
    requested: 0,
    capacity: target.capacity,
    duplicates: [],
    conflicts: [],
    playlistId: params.playlistId ?? '',
    created: false,
    rolledBack: false,
    error,
    ok: false,
    ...extra,
  });

  if (songs.length === 0) return fail('没有可写入的歌曲');

  // ── 落点一：宿主写入路径不会收的歌（数据不完整）──
  const rejections: SongWriteRejection[] = [];
  const wellFormed: Song[] = [];
  for (const song of songs) {
    const rejection = songWriteRejection(song);
    if (rejection) rejections.push(rejection);
    else wellFormed.push(song);
  }

  // ── 落点二：批内重复 ──
  const { unique, duplicates: batchDuplicates } = dedupeBatch(wellFormed);

  // ── 落点三/四：对目标歌单快照判 duplicate / nameConflict ──
  const duplicates: PlaylistDuplicate[] = [];
  const conflicts: PlaylistNameConflict[] = [];
  const fresh: Song[] = [];
  for (const song of unique) {
    const verdict = classifySong(target.songs, song);
    if (verdict.status === 'duplicate' && verdict.existingSong) {
      duplicates.push({ song, existingSong: verdict.existingSong });
    } else if (verdict.status === 'nameConflict' && verdict.existingSong) {
      conflicts.push({ song, existingSong: verdict.existingSong });
    } else {
      fresh.push(song);
    }
  }

  // 同名异源裁决（宿主 adapter 的第二个回调）：一次收整批，宿主可以只问一次。
  let toWrite = fresh;
  let droppedConflicts = 0;
  if (conflicts.length > 0) {
    if (!deps.resolveNameConflict) {
      // 宿主没声明策略 → 默认**并入**（#556 评审 A4）。旧行为是「既不写入也不计数」，
      // 冲突歌凭空消失：这是缺省值撒谎，不是裁决。
      toWrite = [...fresh, ...conflicts.map((c) => c.song)];
    } else {
      let decisions: readonly NameConflictResolution[];
      try {
        const verdict = await deps.resolveNameConflict(conflicts);
        decisions = Array.isArray(verdict) ? verdict : conflicts.map(() => verdict);
      } catch (e) {
        return fail(`同名确认失败: ${(e as Error)?.message || e}`, {
          skipped: batchDuplicates.length + duplicates.length,
          invalid: rejections.length,
          duplicateNames: conflicts.length,
          duplicates,
          conflicts,
        });
      }
      // 裁决为 'add' 的冲突歌要并入写入；'skip' 的丢弃（同时计入 skipped 与 duplicateNames）。
      const accepted = conflicts.filter((_, i) => decisions[i] !== 'skip');
      droppedConflicts = conflicts.length - accepted.length;
      toWrite = [...fresh, ...accepted.map((c) => c.song)];
    }
  }

  const baseCounts = {
    skipped: batchDuplicates.length + duplicates.length + droppedConflicts,
    invalid: rejections.length,
    duplicateNames: conflicts.length,
    duplicates,
    conflicts,
  };

  // 一首都不用写：已有歌单场景不是错误（全是重复/全被裁决掉了），如实回报 0 新增；
  // **新建场景则不能谎报**（#556 评审 B5）：什么都没写就报 ok 会让调用点弹
  // 「已新建歌单…并添加 0 首」并关窗，而歌单根本没建（违反 #551「新歌单出现在列表」）。
  if (toWrite.length === 0) {
    if (params.createName?.trim()) {
      return fail('没有可写入的歌曲（全部已存在或不合格），未新建歌单', {
        ...baseCounts,
        requested: 0,
      });
    }
    return {
      ...fail('', baseCounts),
      ok: true,
      playlistId: params.playlistId ?? '',
      requested: 0,
    };
  }

  // ── 就地新建分支：先建，再写，失败即回滚 ──
  if (params.createName?.trim()) {
    const name = params.createName.trim();
    if (!deps.createPlaylist) return fail('宿主未提供新建歌单能力', baseCounts);
    let newId: string | number;
    try {
      newId = await deps.createPlaylist(name);
    } catch (e) {
      return fail(`新建歌单失败: ${(e as Error)?.message || e}`, baseCounts);
    }
    try {
      const outcome = await writeBatch(newId, toWrite, deps);
      if (outcome.added === 0) {
        // 一首都没进去：新歌单不能留着（#493：绝不允许既没报错又留下空歌单）
        throw new Error('没有歌曲被写入新歌单');
      }
      return {
        ...baseCounts,
        added: outcome.added,
        invalid: baseCounts.invalid + (toWrite.length - outcome.added),
        truncated: outcome.added < toWrite.length,
        requested: toWrite.length,
        capacity: target.capacity,
        playlistId: newId,
        created: true,
        rolledBack: false,
        error: '',
        ok: true,
      };
    } catch (e) {
      let rolledBack = false;
      try {
        await deps.deletePlaylist?.(newId);
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
      return fail(`写入失败: ${(e as Error)?.message || e}`, {
        ...baseCounts,
        playlistId: newId,
        created: true,
        rolledBack,
        requested: toWrite.length,
      });
    }
  }

  // ── 已有歌单分支 ──
  if (params.playlistId === undefined || params.playlistId === '') {
    return fail('未指定目标歌单', baseCounts);
  }
  try {
    const outcome = await writeBatch(params.playlistId, toWrite, deps);
    return {
      ...baseCounts,
      added: outcome.added,
      invalid: baseCounts.invalid + (toWrite.length - outcome.added),
      truncated: outcome.added < toWrite.length,
      requested: toWrite.length,
      capacity: target.capacity,
      playlistId: params.playlistId,
      created: false,
      rolledBack: false,
      error: '',
      ok: true,
    };
  } catch (e) {
    return fail(`写入失败: ${(e as Error)?.message || e}`, {
      ...baseCounts,
      requested: toWrite.length,
    });
  }
}

/**
 * 实际落写：一次整批写入（一次持久化 + 一次渲染）。
 * 返回宿主**真实接纳**的歌数（#554）。
 *
 * #556 评审 B2：逐首回落腿因产线不可达已删（见 `PlaylistWriteDeps.addSongs` 注释）；
 * 本函数只剩唯一一条被产线走到的批量腿。
 */
async function writeBatch(
  playlistId: string | number,
  songs: Song[],
  deps: PlaylistWriteDeps,
): Promise<{ added: number }> {
  const added = await deps.addSongs(playlistId, songs);
  return { added };
}
