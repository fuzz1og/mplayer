import { create } from 'zustand';
import { message } from 'antd';
import { getGlobalPlayer, destroyGlobalPlayer, type PlayerState } from '@/renderer/services/audioPlayer';
import { playbackClock } from '@/renderer/services/playbackClock';
import type { Song, PlaybackFailureAdvice, ShuffleState, ShuffleStep } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';
import {
  findExactMatch,
  getNextSongIndex,
  getPrevSongIndex,
  createShuffleState,
  normalizeShuffleOrder,
  syncShuffleCursor,
  stepShuffle,
  insertNextInShuffle,
  replaceShuffleSongId,
  songUsesSongidLyrics,
  isSodaSource,
  isInlineLyrics,
  decideAfterPlaybackFailure,
  registerTerminalFailure,
  resetFailureStreak,
  getFailureStreak,
  pickNextSongAfterFailure,
  OFFLINE_COPY,
} from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { insertAfter, moveItem } from '@/renderer/utils/reorder';
import { getNextSong, persistQueue, loadQueue, getInitialPlayMode, persistPlayMode, getAutoSkipOnError } from '@/renderer/utils/queueUtils';
import { useSearchStore } from '@/renderer/store/searchStore';
const ipcRenderer = window.electronAPI;

/**
 * 播放封面回填：点击播放时歌曲对象可能还没有封面（DB 里 cover 为空、
 * 或点歌发生在列表刷新完成前）。不覆盖已有封面，只补缺失的 cover。
 * Fire-and-forget，不阻塞播放。
 */
/**
 * 歌词获取（含失败重试）：优先歌曲自带 lrc URL；为空则搜索补全。
 * 获取失败（getLyrics 对「非法请求」页抛错 = 签名与会话绑定、会话已轮换，
 * 旧签名 URL 永远失败）→ 重搜拿新签名 lrc URL 重试一次，对齐手机端
 * fetchLrcInBackground 的 force 路径。返回空串 = 无歌词（不重试）。
 */
async function loadLyricsWithRetry(song: Song): Promise<string> {
  // 存量持久化数据兼容：网易的 lrc 可能是 #409 之前写入的内联 LRC 文本，直接当文本用
  if (isInlineLyrics(song.sourceType, song.lrc)) return song.lrc;

  const searchLrc = async (): Promise<string> => {
    try {
      const results = await callMusicApi('searchSongsRouted', `${song.name} ${song.artist}`, 1, song.sourceType);
      const hit = findExactMatch({ name: song.name, artist: song.artist }, results) as Song | undefined;
      return (hit || results[0])?.lrc?.trim() || '';
    } catch {
      return '';
    }
  };
  const fetchLyrics = (lrcUrl: string): Promise<string> =>
    callMusicApi('getLyrics', lrcUrl);

  let lrc = song.lrc && song.lrc.trim() !== '' ? song.lrc : '';
  // 歌词为空时搜索补全：songid 直取源（网易 #409 / 汽水）跳过——搜索拿不到歌词，
  // 按 ID 直取才是权威答案，搜索只会多打一次请求；其余源返回取词 URL
  if (!lrc && !songUsesSongidLyrics(song.sourceType)) {
    lrc = await searchLrc();
  }
  // 搜索兜底命中的内联文本（只可能来自存量数据）直接返回
  if (lrc && isInlineLyrics(song.sourceType, lrc)) return lrc;

  const lrcUrl = lrc;
  if (!lrcUrl) {
    // songid 直取源：列表结果不带歌词，播放期按源内 ID 直取
    // - 网易（#409）：getNeteaseLyrics(songId) → 歌词端点，key lyric_id_<id>、TTL 1 天
    // - 汽水：分享页免登录结构化歌词（track_v2 需登录态），getSodaLyrics 转 LRC 文本
    if (songUsesSongidLyrics(song.sourceType) && song.id) {
      return isSodaSource(song.sourceType)
        ? callMusicApi('getSodaLyrics', String(song.id))
        : callMusicApi('getNeteaseLyrics', String(song.id));
    }
    return '';
  }
  try {
    return await fetchLyrics(lrcUrl);
  } catch (err) {
    // 失败一次：重搜换新签名 URL 重试（旧签名已随会话轮换失效）
    console.warn('[lyrics] 获取失败，重搜新签名重试:', err);
    await new Promise((r) => setTimeout(r, 600));
    const freshLrc = await searchLrc();
    if (!freshLrc || freshLrc === lrcUrl) throw err;
    if (isInlineLyrics(song.sourceType, freshLrc)) return freshLrc;
    return await fetchLyrics(freshLrc);
  }
}

async function backfillCurrentSongCover(song: Song): Promise<void> {
  try {
    const cover = await refreshSongCover(song);
    if (!cover) return;
    usePlayerStore.setState((state) => {
      if (state.currentSong?.id !== song.id) return state; // 已切歌，丢弃
      if (state.currentSong?.cover) return state; // 已有封面，不覆盖
      return { currentSong: { ...state.currentSong, cover } };
    });
  } catch {
    // 回填失败不影响播放
  }
}

interface PlayerStoreState {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  playerState: PlayerState;
  error: string | null;
  lyrics: string;
  lyricsLoading: boolean;
  playMode: PlayMode;
  currentPlaylist: Song[];
  currentPlaylistIndex: number;
  /**
   * 稳定随机序列（#511）：`null` = 尚无序列（进随机时按当前队列现洗一份）。
   * 「随机序」与 `currentPlaylist`（成员 + 列表循环顺序）是两份数据：随机模式下播放推进、
   * 队列页显示、「下一首播放」的插入位都由它说了算；换回列表循环时保留但不参与。
   */
  shuffle: ShuffleState | null;
}

/** play() 内部选项：fresh = 换新 URL 重试（#385 起连续跳歌计数由 core skipGuard 持有）。 */
export interface PlaybackOptions {
  fresh?: boolean;
}

interface PlayerStoreActions {
  play: (song: Song, options?: PlaybackOptions) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (position: number) => void;
  setVolume: (volume: number) => void;
  setPlayerState: (state: PlayerState) => void;
  clearError: () => void;
  togglePlay: () => void;
  setPlayMode: (mode: PlayMode) => void;
  playNext: () => void;
  playPrevious: () => void;
  /**
   * 「下一首播放」（#491）：把该曲放到**当前曲之后**，不切歌、不打断当前播放。
   * 已在队列时**移动**（不复制）——复制会制造「同一首歌在队列出现多次」这个本仓
   * 已知坏状态（dnd-kit 的 items.indexOf(id) 对重复项索引歧义）。
   * 队列为空 / 尚无当前曲 → 等价于「开始播放这首」。
   */
  insertNext: (song: Song) => Promise<void>;
  setCurrentPlaylist: (playlist: Song[], currentIndex?: number) => void;
  replaceQueueSong: (originalId: string, swapped: Song) => Promise<void>;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  /**
   * 随机模式下的拖拽排序：队列页显示的是**随机序**，所以拖拽改的是序列本身
   * （不重排 currentPlaylist 的成员顺序——那是列表循环的顺序）。
   */
  reorderShuffle: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
}

export type PlayerStore = PlayerStoreState & PlayerStoreActions;

let playGeneration = 0;

const audioPlayer = getGlobalPlayer({
  onStateChange: (state) => {
    usePlayerStore.getState().setPlayerState(state);
    usePlayerStore.setState({
      isPlaying: state === 'playing',
      isLoading: state === 'loading'
    });
    // 采样节奏归 playbackClock：只有真正在播放时才走表
    playbackClock.setPlaying(state === 'playing');
  },
  onDurationChange: (duration) => {
    playbackClock.setDuration(duration);
  },
  onLoadError: (error) => {
    usePlayerStore.setState({
      error: error.message,
      isPlaying: false,
      isLoading: false
    });
    // 与 play() 的 catch 共用同一失败处理：attempt.handled 去重，一次失败只跑一轮
    const attempt = activeAttempt;
    if (attempt) void handlePlaybackFailure(error, attempt);
  },
  onEnd: () => {
    const state = usePlayerStore.getState();
    state.playNext();
  }
});

// 时钟的采样源：只读传输层当前位置（轮询已从 audioPlayer 移出）
playbackClock.connect(() => audioPlayer.getPosition());

const initialQueue = loadQueue();

// --- URL 预解析缓存 ---
// 统一走 core 预取缓存（键 = `sourceType:id`，30min TTL，失败可遗忘）。
// 桌面曾自建模块级 Map：无 TTL、失败不失效，带签名的过期直链会被无期限复用
// 并直接喂给 Howler（onloaderror）——同一份语义不能存在两套规则。

/**
 * 冷启预热：还原的当前歌曲在渲染层有歌名/封面，但传输层尚无 Howl，
 * 用户点播放要走全链重解析（见 resume 守卫）。启动后台预解析一次，
 * 让首次点播放命中预取缓存（30min TTL）0 等待出声——这正是
 * 「隔日打开软件，播放要等/要重试」的正解。
 *
 * **#390 修正**：解析必须经 `musicApi:call` 落到**主进程**那份 `prefetchCache`
 * ——播放解析经 IPC 读的是主进程的模块实例，渲染层自己写的那份没人读（此前
 * `resolvePlayableSongRouted` + 本地 `setPrefetchedUrl` 的写法等于空转）。
 * 覆盖面同时从「仅当前歌」扩到「当前歌 + 队列下一首」（限 2 首、内存、不落盘）。
 *
 * 与 prefetchNextUrl 同口径：失败静默（真正播放时再走正常失败链），
 * 不阻塞启动。由 App 挂载时调用一次（#328）。
 */
export function warmupRestoredSong(): void {
  const state = usePlayerStore.getState();
  const { currentSong } = state;
  const targets: Song[] = [];
  if (currentSong && currentSong.sourceType !== 'local') targets.push(currentSong);
  const next = currentSong ? getNextSongInQueue(state) : null;
  if (next && next.sourceType !== 'local' && next.id !== currentSong?.id) targets.push(next);
  for (const song of targets) {
    callMusicApi('prefetchPlayableSong', song).catch(() => {});
  }
}

/**
 * 获取队列中下一首歌（不改变播放状态）
 * 导出供测试使用
 */
export function getNextSongInQueue(state: PlayerStoreState): Song | null {
  return getNextSong(
    state.currentPlaylist,
    state.currentPlaylistIndex,
    state.playMode,
    state.currentSong,
    state.shuffle,
  );
}

/** 两份队列是否同一批歌（只看 id 集合）——区分「整批换队列」与「同一队列原地改」（封面回填等）。 */
function sameSongIdSet(a: readonly Song[], b: readonly Song[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((s) => s.id));
  return b.every((s) => ids.has(s.id));
}

/** `syncShuffle` 的选项。 */
interface ShuffleSyncOptions {
  /** 队列被整批替换（setCurrentPlaylist）：id 集合变了才允许重洗，同一批歌保持既有顺序。 */
  reseed?: boolean;
  /** 原位换源：先在序列里把 fromId 就地换成 toId（同一格），再对齐。 */
  replaceId?: { from: string; to: string };
}

/**
 * 随机序的**唯一同步入口**（#511）：所有会改队列成员或播放落点的路径都调它，
 * 游标语义只在这一处维护——避免各 set 点手抄 create/sync 而漏同步
 * （评审实测：失败跳歌就曾漏过一次，游标停在坏歌上）。
 *
 * - 已有序列 → 成员增量对齐（丢不在队列的、新歌补末尾，**不重洗**）+ 游标对到
 *   `playlist[cursorIndex]`；`cursorIndex` = 当前播放曲在队列中的下标，`-1` = 无当前曲（游标 -1）。
 * - 没有序列 → 随机模式下按当前队列现洗一份（游标落到 `cursorIndex`），其余模式保持 `null`。
 * - `replaceId`：先把 fromId 就地换成 toId（顺序与格位不变），再按上面规则对齐。
 * - `reseed`：队列 id 集合变了才让旧序列作废（随机模式重洗，其余模式清空）。
 */
function syncShuffle(
  state: PlayerStoreState,
  playlist: Song[],
  cursorIndex: number,
  options: ShuffleSyncOptions = {},
): ShuffleState | null {
  let base = state.shuffle;
  if (base && options.replaceId) {
    base = replaceShuffleSongId(base, options.replaceId.from, options.replaceId.to);
  }
  const reseed = options.reseed === true && !sameSongIdSet(state.currentPlaylist, playlist);
  if (!base || reseed) {
    return state.playMode === '随机播放' && playlist.length > 0
      ? createShuffleState(playlist, { currentIndex: cursorIndex })
      : null;
  }
  return syncShuffleCursor(base, playlist, cursorIndex);
}

/**
 * next / prev：先把游标对到**当前播放曲**（防脏数据导致游标漂移），再消费序列推进一格。
 * 没有序列且非随机 → null（调用方走列表循环）。
 */
function stepShuffleFromCurrent(state: PlayerStoreState, direction: 1 | -1): ShuffleStep | null {
  const base = syncShuffle(state, state.currentPlaylist, state.currentPlaylistIndex);
  return base ? stepShuffle(base, state.currentPlaylist, direction) : null;
}

/**
 * 后台预解析下一首歌的 URL（fire-and-forget）
 */
function prefetchNextUrl(state: PlayerStoreState): void {
  const nextSong = getNextSongInQueue(state);
  if (!nextSong || nextSong.sourceType === 'local') return;

  // 自我预取守卫：单元素队列列表循环回绕会算出当前歌自己，预取自己无意义。
  // 比较口径与 core 预取缓存键同口径（`${sourceType}:${id}` 组合键）：跨源数字 id
  // 相同不算同一首（kuwo:123 ≠ netease:123），只比 id 会误拦合法的下一首预取
  const nextKey = `${nextSong.sourceType}:${nextSong.id}`;
  const currentKey = state.currentSong ? `${state.currentSong.sourceType}:${state.currentSong.id}` : '';
  if (nextKey === currentKey) return;

  // #390：解析与写入都在**主进程**完成（core 门面 prefetchPlayableSong），
  // 渲染层无法也不应自持缓存视图；「已有未过期条目」（30min TTL）由 core 侧跳过。
  callMusicApi('prefetchPlayableSong', nextSong).catch(() => {});
}

// --- 播放失败处理（对齐移动端 packages/mobile/services/audioPlayer.ts） ---
/**
 * 单次播放尝试的上下文。同一次 load 失败会同时触发 audioPlayer 回调与
 * play() 的 catch，用 handled 去重，保证一次失败只跑一轮「重试 / 跳歌」。
 */
interface PlayAttempt {
  songId: string;
  fresh: boolean;
  handled: boolean;
}

let activeAttempt: PlayAttempt | null = null;

/**
 * 解析链穷尽（直连 + tier3 都没拿到 URL）错误（#357）：携带 core 的失败归因。
 * 归因由 core `explainPlaybackFailure` 按当前配置给出（无声明源 / 全被归属跳过 /
 * 源都试了没命中 / tier3 未开启…），桌面经 IPC 取回，与移动端共用同一份文案。
 */
class PlayableUrlMissingError extends Error {
  constructor(readonly advice: PlaybackFailureAdvice | null) {
    super(advice?.message ?? '无法获取音频 URL：可能为 VIP/无版权或直连暂不可用，可尝试换源');
    this.name = 'PlayableUrlMissingError';
  }
}

/** 失败原因归类（提示文案）：解析链穷尽（带归因）vs 播放器 / 网络 */
function failureReasonText(error: unknown): string {
  // 解析链穷尽只从 PlayableUrlMissingError 抛出（其余失败=播放器/网络）
  if (error instanceof PlayableUrlMissingError) {
    return error.advice?.message ?? '直连与全部订阅源均未命中';
  }
  return '音源解析失败';
}

/** 离线判定（#385）：core 零 I/O，离线态由宿主注入 predicate。
 *  桌面用 navigator 的**明确否定态**（在线但不可达由解析链自身的上界兜住：
 *  直连 3s 墙 + tier3 6s + 固定跳歌上限）。 */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * 统一失败处理（#385：护栏语义与文案收敛到 core `skipGuard` 单一来源）：
 * 1) 同曲 fresh 重试一次（先遗忘失败直链，再重走直连 → tier3）；
 * 2) 仍失败 = **终局失败**：core 记一次（连续计数 +1、记住这首歌）；
 * 3) core 决策：离线 / 关闭「失败即跳」/ 连续失败达固定上限 / 无下一首 → 停；
 *    否则跳下一首（跳过坏歌）。文案一律取 `decision.copy`。
 * 本地文件不会过期：不做 fresh 重试，失败直接进决策。
 */
async function handlePlaybackFailure(error: unknown, attempt: PlayAttempt): Promise<void> {
  if (attempt.handled) return;
  attempt.handled = true;
  // 已被新一次 play 取代（用户手动切歌等）：旧失败不再处理
  if (activeAttempt !== attempt) return;

  const store = usePlayerStore.getState();
  const song = store.currentSong;
  if (!song || song.id !== attempt.songId) return;

  const reasonText = failureReasonText(error);

  if (!attempt.fresh && song.sourceType !== 'local') {
    // #390：遗忘必须打到主进程那份缓存（渲染层那份无人读）
    await callMusicApi('forgetPrefetchedSong', song).catch(() => {});
    await store.play(song, { fresh: true });
    return;
  }

  const offline = isOffline();
  // 离线不算「源失败」：不计数、不记坏歌（只提示离线）。非离线才是终局失败——
  // core 单一来源地记一次（连续计数 +1、记住这首歌）。
  const consecutiveFailures = offline ? getFailureStreak() : registerTerminalFailure(song);
  if (!offline && song.sourceType !== 'local') {
    useSearchStore.getState().setAudioTag(song.id, 'invalid');
  }

  // 跳歌候选由 core 选（跳过会话内已证明失效的歌；两端同一份语义）
  const next = pickNextSongAfterFailure(
    store.currentPlaylist,
    store.currentPlaylistIndex,
    store.playMode,
    song.id,
    store.shuffle,
  );
  const decision = decideAfterPlaybackFailure({
    songName: song.name,
    reasonText,
    offline,
    autoSkip: getAutoSkipOnError(),
    hasNextSong: !!next,
    consecutiveFailures,
    isLocal: song.sourceType === 'local',
  });

  if (decision.action === 'stop' || !next) {
    audioPlayer.stop();
    usePlayerStore.setState({
      error: error instanceof Error ? error.message : '播放失败',
      isLoading: false,
      isPlaying: false
    });
    message.error(decision.copy);
    return;
  }

  // 跳歌也是「播放落点」：游标必须跟着走，否则稳定序列当场失效
  //（预取会按坏歌位置算下一首、再点下一首会重播正在播的这首）
  const nextShuffle = syncShuffle(store, store.currentPlaylist, next.index);
  usePlayerStore.setState({ currentPlaylistIndex: next.index, shuffle: nextShuffle });
  persistQueue(store.currentPlaylist, next.index, nextShuffle);
  message.warning(decision.copy);
  await store.play(next.song);
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentSong: initialQueue.index >= 0 && initialQueue.index < initialQueue.playlist.length
    ? initialQueue.playlist[initialQueue.index]
    : null,
  isPlaying: false,
  isLoading: false,
  volume: audioPlayer.getVolume(),
  playerState: 'idle',
  error: null,
  lyrics: '',
  lyricsLoading: false,
  playMode: getInitialPlayMode(),
  currentPlaylist: initialQueue.playlist,
  currentPlaylistIndex: initialQueue.index,
  shuffle: initialQueue.shuffle,

  play: async (song: Song, options: PlaybackOptions = {}) => {
    const { fresh = false } = options;
    const { isLoading, currentSong } = get();

    if (isLoading && currentSong?.id === song.id) {
      return;
    }

    // #385：离线快速失败——判定离线就直接停并告知，**不进解析链**
    //（省掉直连 3s 墙 + tier3 6s；文案与终端决策取同一来源）。
    if (song.sourceType !== 'local' && isOffline()) {
      audioPlayer.stop();
      activeAttempt = null;
      // #397 验收遗留：这里也必须归零位置读模型。否则播放栏显示「刚点的歌 + 上一首的
      // 00:05 / 05:19」——歌名换了、进度没换，一次「已停止」说了假话（与 #328 同源）。
      // 时长保留旧值到新曲加载完成，与下方正常路径同一口径。
      playbackClock.setPosition(0);
      set({ error: OFFLINE_COPY, isLoading: false, isPlaying: false, currentSong: song });
      message.error(OFFLINE_COPY);
      return;
    }

    const generation = ++playGeneration;
    audioPlayer.cancelLoad();
    // 登记本次尝试：load 失败会同时触发 audioPlayer 回调与下方 catch，靠 attempt 去重
    const attempt: PlayAttempt = { songId: song.id, fresh, handled: false };
    activeAttempt = attempt;
    /** 是否已真正开始播放：用于区分「播放失败」与「播放后簿记异常」 */
    let playStarted = false;

    try {
      // #387 核对：isLoading 在这里就置位，直到 load 成功/失败才落定——覆盖**整段等待窗口**，
      // 包含解析链（直连 3s 墙 + tier3 6s 兜底）与 audioPlayer 的 loading 态；播放键据此显示 spinner。
      set({
        error: null,
        isLoading: true,
        currentSong: song,
        lyrics: '',
        lyricsLoading: false
      });
      // 位置读模型归零（时长保留旧值到新曲加载完成，与旧 store 行为一致）
      playbackClock.setPosition(0);

      let realUrl = song.url;
      let playbackNonFull = false;

      if (song.sourceType === 'soda' && !song.url) {
        try {
          realUrl = await callMusicApi('getSodaPlayableUrl', song.id);
        } catch (urlError) {
          console.error('获取汽水音乐可播放 URL 失败:', urlError);
        }
      } else if (song.sourceType !== 'local') {
        // fresh 重试语义：先遗忘该曲预取条目——里面是刚被证明失败的直链，
        // 0 等待命中只会原地连败两次（core 预取缓存 30min TTL + 失败可遗忘）。
        // #390：遗忘经 IPC 打到主进程那份缓存（渲染层那份没人读）。
        if (fresh) await callMusicApi('forgetPrefetchedSong', song).catch(() => {});
        try {
          // T12：带试听版检测的播放解析（nonFull 标记驱动换元提示）。
          // 预取命中在 core 内部完成，这里不再自建缓存分支。
          const resolved = await callMusicApi('resolvePlayableSongRouted', song);
          realUrl = resolved?.url || '';
          if (resolved?.nonFull && realUrl) {
            console.warn(`[player] 《${song.name}》解析结果为试听版（non-full），可换源获取完整版`);
            song.nonFull = true;
            playbackNonFull = true;
            // preview 立即播直连试听（秒出声），不再等 tier3
            useSearchStore.getState().setAudioTag(song.id, 'preview');
            message.info('当前为试听版，可换源获取完整版');
          }
        } catch (urlError) {
          // 失败反馈与「重试 / 跳歌」决策统一交给 handlePlaybackFailure，避免重复 Toast
          console.error('获取真实音频 URL 失败:', urlError);
          realUrl = '';
        }
      }

      // 无 url 歌曲（直连解析失败 / 列表未带 url）：按歌名搜索解析一次，
      // 失败走下方报错。「受保护端点死链 fresh 兜底」分支已随 searchSongById
      // 死腿删除（自建 API 退役后恒 null，#273）。
      if (!realUrl && song.sourceType !== 'local' && song.sourceType !== 'soda' && song.name) {
        try {
          const results = await callMusicApi('searchSongsRouted', `${song.name} ${song.artist}`.trim(), 1, song.sourceType);
          const hit = findExactMatch({ name: song.name, artist: song.artist }, results) as Song | undefined;
          if (hit?.url) realUrl = hit.url;
        } catch (urlError) {
          console.error('播放时搜索歌曲 URL 失败:', urlError);
        }
      }

      if (generation !== playGeneration) {
        set({ isLoading: false });
        return;
      }

      if (!realUrl) {
        set({ isLoading: false });
        // 失败归因（#357）：core 按当前配置给出可操作文案（没有声明对应 source 的源 /
        // 全部因归属被跳过 / 源都试了没命中 / tier3 未开启…），双端共用同一份，
        // 不再把用户引向「可能为 VIP/无版权」的错误方向。归因失败退回原通用文案。
        const advice = await callMusicApi('explainPlaybackFailure', song).catch(() => null);
        // 「不可播」徽标回写与重试 / 跳歌决策统一在 handlePlaybackFailure
        throw new PlayableUrlMissingError(advice);
      }

      const songWithRealUrl = { ...song, url: realUrl };
      await audioPlayer.load(songWithRealUrl);

      if (generation !== playGeneration) {
        set({ isLoading: false });
        return;
      }

      audioPlayer.play();
      playStarted = true;
      // #385：真正开始播放 → 连续失败链中断（**只有这里**归零；手动点歌不清零）
      resetFailureStreak();

      // 完整版播放成功 → 回写 valid，清掉该行旧的失败徽标（试听版保留 preview）
      if (!playbackNonFull) {
        useSearchStore.getState().setAudioTag(song.id, 'valid');
      }

      playbackClock.setDuration(audioPlayer.getDuration());

      set({
        isLoading: false,
        isPlaying: true
      });

      // Fire-and-forget: 封面回填（点歌时 cover 可能为空，播放栏不显示兜底图）
      if (!song.cover) {
        backfillCurrentSongCover(song).catch(() => {});
      }

      // Fire-and-forget: 歌词获取不阻塞播放（失败自动重搜新签名重试一次）
      const requestingSongId = song.id;
      set({ lyricsLoading: true });
      loadLyricsWithRetry(song)
        .then((lyricsContent) => {
          if (get().currentSong?.id === requestingSongId) {
            set({ lyrics: lyricsContent, lyricsLoading: false });
          }
        })
        .catch((lyricsError) => {
          console.error('获取歌词失败:', lyricsError);
          if (get().currentSong?.id === requestingSongId) {
            set({ lyrics: '', lyricsLoading: false });
          }
        });

      // Fire-and-forget: 历史记录写入不阻塞播放
      IpcClient.invoke('history:add', song).catch((err) => {
        console.error('写入播放历史失败:', err);
      });

      // 同步更新队列（本地操作，无 IPC 开销）
      const playlist = get().currentPlaylist;
      const index = playlist.findIndex(s => s.id === song.id);
      if (index === -1) {
        const newPlaylist = [...playlist, song];
        const appendedIndex = newPlaylist.length - 1;
        set({
          currentPlaylist: newPlaylist,
          currentPlaylistIndex: appendedIndex,
          shuffle: syncShuffle(get(), newPlaylist, appendedIndex),
        });
      } else {
        set({
          currentPlaylistIndex: index,
          shuffle: syncShuffle(get(), playlist, index),
        });
      }
      persistQueue(get().currentPlaylist, get().currentPlaylistIndex, get().shuffle);

      // 预取必须放在队列 index 同步之后（#318）：手动点播路径（QueuePage 双击行、
      // 历史/本地/发现页单曲点播）不先同步 index，若在 set({ currentSong }) 后立即
      // 预取，会基于「新 currentSong + 旧 index」算出刚开播的这首歌自己——当前歌被
      // 重复解析、真正的下一首漏预取。走到这里时各路径 index 均已就位：playNext/
      // playPrevious/onEnd 在进 play 前已同步；页面级点播为 setCurrentPlaylist + play；
      // 队列外点歌由上方 append 进队并置尾 index。失败/被取代（generation 早退）路径
      // 不会走到这里。
      prefetchNextUrl(get());

    } catch (error) {
      if (generation !== playGeneration) return;
      if (playStarted) {
        // 播放已经开始：后面只是簿记（历史 / 队列 / 封面 / 歌词），异常不得当成播放失败误跳歌
        console.error('播放后处理失败（不影响播放）:', error);
        return;
      }
      // 先落定 loading/playing：load 失败可能只以 reject 形式到达（onLoadError 未触发），
      // 不清掉会让 fresh 重试被 play() 的「同一首正在加载」守卫直接吞掉。
      set({ isLoading: false, isPlaying: false });
      // 解析 / 加载失败统一走失败处理：同曲 fresh 重试一次 → 仍失败自动跳下一首
      await handlePlaybackFailure(error, attempt);
    }
  },

  pause: () => {
    audioPlayer.pause();
    set({ isPlaying: false });
  },

  resume: () => {
    const { currentSong } = get();
    // 无歌可播（空播放栏）：不得谎报 isPlaying——否则声波动画空转
    // 且后续 togglePlay 会走进 pause 分支（同一类状态说谎，#328）。
    if (!currentSong) return;
    // 无可用音频时不能走「恢复播放」：传输层没有能出声的 Howl。
    // 两种来源——冷启还原态（渲染层从队列还原了歌，传输层还在 idle）
    // 与上次加载失败（error，howl 仍在但已死）。
    // 此时 audioPlayer.play() 是静默空操作（其内部 howl/state 守卫），
    // 而旧代码无条件 set({ isPlaying: true }) 会让声波动画空转、
    // 进度条说谎（#328）。
    // 改为走 play() 全链重新解析并从 0 播（位置不恢复 = #328 的裁决）。
    // 修在这一层而非 PlayerBar：resume/togglePlay 共 5 个入口
    // （播放栏 / 歌词页 / 全局快捷键 / 媒体键 / 托盘）。
    const transportState = audioPlayer.getState();
    if (transportState === 'idle' || transportState === 'error') {
      // 上次是加载失败：先遗忘该曲预取条目（里面是刚被证明失败的直链），
      // 否则 0 等待命中坏链接原地连败（与 handlePlaybackFailure 同口径）。
      void get().play(currentSong, { fresh: transportState === 'error' });
      return;
    }
    audioPlayer.play();
    set({ isPlaying: true });
  },

  stop: () => {
    audioPlayer.stop();
    playbackClock.reset();
    set((state) => ({
      currentSong: null,
      isPlaying: false,
      currentPlaylistIndex: -1,
      // 序列保留、游标归位：没有当前曲了，next 从序列开头起
      shuffle: syncShuffle(state, state.currentPlaylist, -1),
    }));
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex, get().shuffle);
  },

  seek: (position: number) => {
    audioPlayer.seek(position);
    // 立即改写读模型：暂停中 seek 也要马上反映（不依赖下一次采样）
    playbackClock.setPosition(position);
  },

  setVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    audioPlayer.setVolume(clampedVolume);
    set({ volume: clampedVolume });
  },

  setPlayerState: (state: PlayerState) => {
    set({ playerState: state });
  },

  clearError: () => {
    set({ error: null });
  },

  togglePlay: () => {
    const { currentSong, isPlaying } = get();
    if (!currentSong) return;

    if (isPlaying) {
      get().pause();
    } else {
      get().resume();
    }
  },

  setPlayMode: (mode: PlayMode) => {
    set((state) => ({
      playMode: mode,
      // 进随机：把游标对到当前曲（没有序列就现洗一份）；换回列表/单曲：序列保留但不参与。
      // 注意用 `{...state, playMode: mode}` 传"新模式"——set 回调里的 state 还是旧的，
      // 否则 syncShuffle 会按旧的列表模式判定"不建序列"。
      shuffle:
        mode === '随机播放'
          ? syncShuffle({ ...state, playMode: mode }, state.currentPlaylist, state.currentPlaylistIndex)
          : state.shuffle,
    }));
    persistPlayMode(mode);
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex, get().shuffle);
  },

  playNext: () => {
    const { currentPlaylist, currentPlaylistIndex, playMode, currentSong } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      get().stop();
      return;
    }

    // 单曲循环：刻意保留 seek(0)+play 特例（走 seek 复播而非 play()/URL，
    // 避免切走 → reload 的音轨闪烁），不走 core 队列算法与 play() 主链路
    if (playMode === '单曲循环') {
      if (currentSong) {
        audioPlayer.seek(0);
        audioPlayer.play();
        playbackClock.setPosition(0);
        set({ isPlaying: true, error: null });
      }
      return;
    }

    // 随机（#511）：消费稳定序列——游标前进一格（没有序列就按当前队列现洗一份）
    if (playMode === '随机播放') {
      const step = stepShuffleFromCurrent(get(), 1);
      if (!step || step.index === -1) {
        get().stop();
        return;
      }
      set({ currentPlaylistIndex: step.index, shuffle: step.state });
      get().play(currentPlaylist[step.index]);
      return;
    }

    // 列表循环统一收敛到 core getNextSongIndex（回绕）
    const nextIndex = getNextSongIndex(currentPlaylist, currentPlaylistIndex, playMode);
    if (nextIndex === -1) {
      get().stop();
      return;
    }
    set({ currentPlaylistIndex: nextIndex });
    get().play(currentPlaylist[nextIndex]);
  },

  playPrevious: () => {
    const { currentPlaylist, currentPlaylistIndex, playMode } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      return;
    }

    // 随机（#511 行为变更）：游标后退一格——回到序列里的上一张，不再现抽
    if (playMode === '随机播放') {
      const step = stepShuffleFromCurrent(get(), -1);
      if (!step || step.index === -1) return;
      set({ currentPlaylistIndex: step.index, shuffle: step.state });
      get().play(currentPlaylist[step.index]);
      return;
    }

    // 单曲循环 / 列表循环统一收敛到 core getPrevSongIndex（单曲不做重播、列表回绕）
    const prevIndex = getPrevSongIndex(currentPlaylist, currentPlaylistIndex, playMode);
    if (prevIndex === -1) return;
    set({ currentPlaylistIndex: prevIndex });
    get().play(currentPlaylist[prevIndex]);
  },

  insertNext: async (song: Song) => {
    const { currentPlaylist, currentPlaylistIndex, currentSong, playMode } = get();

    // 队列为空：没有「下一首」这个位置，等价于「开始播放这首」
    if (currentPlaylist.length === 0) {
      const nextShuffle = syncShuffle(get(), [song], 0);
      set({ currentPlaylist: [song], currentPlaylistIndex: 0, shuffle: nextShuffle });
      persistQueue([song], 0, nextShuffle);
      await get().play(song);
      return;
    }

    // 有队列但无当前曲（stop() 之后的形态：队列留着、index = -1）：
    // 没有「当前曲之后」这个位置，等价于「开始播放这首」，不往队列里插
    if (currentPlaylistIndex === -1) {
      await get().play(song);
      return;
    }

    // 已在队列 → 移动；否则 → 插入。**按 id 判定**（与 removeFromQueue/replaceQueueSong 的队列身份口径一致）。
    // 移动分支刻意**保留队列里那份 song 对象**：用户点的可能来自刚刷新过的列表（封面不同），
    // 「已在队列」的语义是「挪位置」，静默换掉一份元数据会让队列条目突变。
    const existingIndex = currentPlaylist.findIndex(s => s.id === song.id);

    // 随机（#511）：播放顺序由序列说了算——插到**随机序里当前曲的下一格**。
    // 队列成员只负责「在不在」，新歌追加进成员即可；当前曲与播放指针都不动。
    // 点的是当前曲本身 / 已在目标格 → no-op（与 #506 列表分支的幂等语义一致；移动端接缝见 ADR）。
    if (playMode === '随机播放') {
      const currentId = currentPlaylist[currentPlaylistIndex]?.id;
      if (song.id === currentId) return;

      const nextQueue = existingIndex === -1 ? [...currentPlaylist, song] : currentPlaylist;
      const base = syncShuffle(get(), nextQueue, currentPlaylistIndex);
      const nextShuffle = base ? insertNextInShuffle(base, nextQueue, song.id, currentPlaylistIndex) : null;
      set({ currentPlaylist: nextQueue, shuffle: nextShuffle });
      persistQueue(nextQueue, currentPlaylistIndex, nextShuffle);

      if (existingIndex === -1 && !currentSong) await get().play(song);
      return;
    }

    // 幂等：它已经在「当前曲之后」这一位 → 什么都不做（连点两次结果稳定、队列长度不变）
    if (existingIndex === currentPlaylistIndex + 1) return;

    let nextQueue: Song[];
    let nextIndex = currentPlaylistIndex;

    if (existingIndex === -1) {
      // 插入：当前位置之后，当前曲不动
      nextQueue = insertAfter(currentPlaylist, currentPlaylistIndex, song);
    } else {
      // 移动：**移除源条目之后**当前曲的下标会变——源下标在当前曲之前时，当前曲左移一格。
      // 目标位 = 移动后「当前曲」的下一格，不是原来的 currentIndex+1（否则会把歌插到当前曲再后面一格）。
      nextIndex = existingIndex < currentPlaylistIndex ? currentPlaylistIndex - 1 : currentPlaylistIndex;
      nextQueue = moveItem(currentPlaylist, existingIndex, nextIndex + 1);
    }

    // 移动分支若当前曲本身被挪动才需要改指针；上面 nextIndex 已按此算好，插入分支恒等于原值。
    const nextShuffle = syncShuffle(get(), nextQueue, nextIndex);
    set({ currentPlaylist: nextQueue, currentPlaylistIndex: nextIndex, shuffle: nextShuffle });
    persistQueue(nextQueue, nextIndex, nextShuffle);

    // 队列里没这首、且当前没有在播的曲目 → 直接开始播它（有在播的曲子则**绝不打断**，这是本动作的核心承诺）
    if (existingIndex === -1 && !currentSong) await get().play(song);
  },

  setCurrentPlaylist: (playlist: Song[], currentIndex: number = -1) => {
    const nextShuffle = syncShuffle(get(), playlist, currentIndex, { reseed: true });
    set({
      currentPlaylist: playlist,
      currentPlaylistIndex: currentIndex,
      shuffle: nextShuffle,
    });
    persistQueue(playlist, currentIndex, nextShuffle);
  },

  /**
   * 单曲换源后的队列原位替换：命中当前播放歌曲则替换并续播新版本，
   * 未命中只替换队列条目，不打断当前播放。
   */
  replaceQueueSong: async (originalId: string, swapped: Song) => {
    const { currentPlaylist, currentPlaylistIndex, currentSong } = get();
    const idx = currentPlaylist.findIndex(s => s.id === originalId);

    if (idx === -1) {
      if (currentSong?.id === originalId) await get().play(swapped);
      return;
    }

    const queue = [...currentPlaylist];
    queue[idx] = swapped;

    // 换源换的是同一格的条目：序列里就地改 id（顺序与格位不变），游标仍对到当前曲
    const nextShuffle = syncShuffle(get(), queue, currentSong?.id === originalId ? idx : currentPlaylistIndex, {
      replaceId: { from: originalId, to: swapped.id },
    });

    if (currentSong?.id === originalId) {
      set({ currentPlaylist: queue, currentPlaylistIndex: idx, currentSong: swapped, shuffle: nextShuffle });
      persistQueue(queue, idx, nextShuffle);
      await get().play(swapped);
    } else {
      set({ currentPlaylist: queue, shuffle: nextShuffle });
      persistQueue(queue, currentPlaylistIndex, nextShuffle);
    }
  },

  removeFromQueue: (index: number) => {
    const { currentPlaylist, currentPlaylistIndex } = get();
    if (index < 0 || index >= currentPlaylist.length) return;

    const newPlaylist = currentPlaylist.filter((_, i) => i !== index);
    let newIndex = currentPlaylistIndex;

    if (newPlaylist.length === 0) {
      get().stop();
      persistQueue([], -1, null);
      return;
    }

    if (index === currentPlaylistIndex) {
      // 移除的是当前播放歌曲，播放下一首
      const nextSong = newPlaylist[index] || newPlaylist[0];
      const resumedIndex = index < newPlaylist.length ? index : 0;
      const nextShuffle = syncShuffle(get(), newPlaylist, resumedIndex);
      set({
        currentPlaylist: newPlaylist,
        currentPlaylistIndex: resumedIndex,
        shuffle: nextShuffle,
      });
      persistQueue(newPlaylist, resumedIndex, nextShuffle);
      get().play(nextSong);
      return;
    }

    if (index < currentPlaylistIndex) {
      newIndex = currentPlaylistIndex - 1;
    }

    const nextShuffle = syncShuffle(get(), newPlaylist, newIndex);
    set({
      currentPlaylist: newPlaylist,
      currentPlaylistIndex: newIndex,
      shuffle: nextShuffle,
    });
    persistQueue(newPlaylist, newIndex, nextShuffle);
  },

  reorderQueue: (fromIndex: number, toIndex: number) => {
    const { currentPlaylist, currentPlaylistIndex } = get();
    if (fromIndex < 0 || fromIndex >= currentPlaylist.length) return;
    if (toIndex < 0 || toIndex >= currentPlaylist.length) return;
    if (fromIndex === toIndex) return;

    // 索引数学走共享 moveItem：队列拖拽、本地歌单拖拽、store 内部同一份实现
    const newPlaylist = moveItem(currentPlaylist, fromIndex, toIndex);

    // 同步更新 currentPlaylistIndex
    let newIndex = currentPlaylistIndex;
    if (currentPlaylistIndex === fromIndex) {
      newIndex = toIndex;
    } else if (fromIndex < currentPlaylistIndex && toIndex >= currentPlaylistIndex) {
      newIndex = currentPlaylistIndex - 1;
    } else if (fromIndex > currentPlaylistIndex && toIndex <= currentPlaylistIndex) {
      newIndex = currentPlaylistIndex + 1;
    }

    // 成员顺序变了：序列增量对齐即可（顺序不重洗，游标跟随当前曲）
    const nextShuffle = syncShuffle(get(), newPlaylist, newIndex);
    set({
      currentPlaylist: newPlaylist,
      currentPlaylistIndex: newIndex,
      shuffle: nextShuffle,
    });
    persistQueue(newPlaylist, newIndex, nextShuffle);
  },

  /**
   * 随机模式下的拖拽：队列页显示的就是随机序，所以拖拽改的是**序列本身**
   * （不重排 currentPlaylist 的成员顺序——那是列表循环的顺序）。游标跟随当前曲。
   */
  reorderShuffle: (fromIndex: number, toIndex: number) => {
    const { currentPlaylist, currentPlaylistIndex, shuffle } = get();
    if (!shuffle) return;
    // **先归一**：队列页拖拽下标来自 applyShuffleOrder（长度恒 = 队列长度），
    // 而持久化/脏数据里的 order 可能不是全排列。归一后 order 与队列等长，索引域收成一处，
    // 否则「拖最后几行被静默拒绝」。
    const normalized = normalizeShuffleOrder(shuffle, currentPlaylist);
    const total = normalized.order.length;
    if (fromIndex < 0 || fromIndex >= total || toIndex < 0 || toIndex >= total) return;
    if (fromIndex === toIndex) return;

    // 索引数学与列表拖拽共用 moveItem（「列表索引数学只此一份」）
    const order = moveItem(normalized.order, fromIndex, toIndex);
    const currentId = currentPlaylist[currentPlaylistIndex]?.id;
    const nextShuffle = { order, cursor: currentId ? order.indexOf(currentId) : -1 };
    set({ shuffle: nextShuffle });
    persistQueue(currentPlaylist, currentPlaylistIndex, nextShuffle);
  },

  clearQueue: () => {
    get().stop();
    set({
      currentPlaylist: [],
      currentPlaylistIndex: -1,
      shuffle: null,
    });
    persistQueue([], -1, null);
  },
}));

// Sync state to tray when currentSong or isPlaying changes
// NOTE: ipcRenderer is already imported at line 6
let lastTraySongId = '';
let lastTrayIsPlaying: boolean | null = null;
usePlayerStore.subscribe((state) => {
  if (state.currentSong) {
    const songChanged = state.currentSong.id !== lastTraySongId;
    const playStateChanged = state.isPlaying !== lastTrayIsPlaying;
    if (songChanged || playStateChanged) {
      lastTraySongId = state.currentSong.id;
      lastTrayIsPlaying = state.isPlaying;
      ipcRenderer.send('tray:state', {
        songName: state.currentSong.name,
        artist: state.currentSong.artist,
        isPlaying: state.isPlaying,
      });
    }
  }
});

export function destroyPlayer(): void {
  playbackClock.destroy();
  destroyGlobalPlayer();
}
