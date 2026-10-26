import { create } from 'zustand';
import { message } from 'antd';
import { getGlobalPlayer, destroyGlobalPlayer, type PlayerState } from '@/renderer/services/audioPlayer';
import { playbackClock } from '@/renderer/services/playbackClock';
import type { Song, PlaybackFailureAdvice, ShuffleState, AdvancePlan } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';
import {
  findExactMatch,
  planAdvance,
  stepShuffle,
  alignShuffleOrder,
  normalizeShuffleOrder,
  insertNextInShuffle,
  isInlineLyrics,
  planLyricsFetch,
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
import { resolvePlaybackUrl, type ResolvePlaybackUrlDeps } from '@/renderer/services/resolvePlaybackUrl';
import { planQueueState } from '@/renderer/store/queueState';
import { insertAfter, moveItem, removeAt, moveTo } from '@/renderer/utils/reorder';
import { getNextSong, persistQueue, loadQueue, getInitialPlayMode, persistPlayMode, getAutoSkipOnError } from '@/renderer/utils/queueUtils';
import { useSearchStore } from '@/renderer/store/searchStore';
const ipcRenderer = window.electronAPI;

/**
 * 播放封面回填：点击播放时歌曲对象可能还没有封面（DB 里 cover 为空、或点歌发生在列表刷新完成前）。
 * 失败重试（仅 URL 腿）：getLyrics 对「非法请求」页抛错 = 签名与会话绑定、会话已轮换，旧签名 URL 永
 * 远失败 → 重搜拿新签名 lrc URL 重试一次，对齐手机端 fetchLrcInBackground 的 force 路径。
 */
async function loadLyricsWithRetry(song: Song): Promise<string> {
  // #556：只接受**精确匹配**的歌词（此前 `hit || results[0]` 在无精确匹配时取第一条，
  // 正是 #544 / ADR-0012 要杀的翻唱误配；移动端同场景只认精确匹配）。候选里没有
  // 同名同歌手 → 返回空串 = 本轮无歌词，而不是挂上别人的歌词。
  const searchLrc = async (): Promise<string> => {
    try {
      const results = await callMusicApi('searchSongsRouted', `${song.name} ${song.artist}`, 1, song.sourceType);
      const hit = findExactMatch({ name: song.name, artist: song.artist }, results) as Song | undefined;
      return hit?.lrc?.trim() || '';
    } catch {
      return '';
    }
  };
  const fetchLyrics = (lrcUrl: string): Promise<string> =>
    callMusicApi('getLyrics', lrcUrl);

  // 取词决策在 core 单点（`planLyricsFetch`，与下载侧车同一份，防漂移），这里只接 I/O。
  const plan = planLyricsFetch(song);
  if (plan.kind === 'inline') return plan.text;
  if (plan.kind === 'songid') {
    // 按 ID 直取源：列表结果不带歌词，播放期按源内 ID 直取
    // - 网易（#409）：getNeteaseLyrics(songId) → 歌词端点，key lyric_id_<剥完前缀的裸 id>、TTL 1 天
    // - 汽水：分享页免登录结构化歌词（track_v2 需登录态），getSodaLyrics 转 LRC 文本
    return plan.source === 'soda'
      ? callMusicApi('getSodaLyrics', plan.id)
      : callMusicApi('getNeteaseLyrics', plan.id);
  }

  // `url`：歌曲自带取词 URL；`none`：非按 ID 直取源且 lrc 为空 → 搜索补全一次
  //（#409 允许的唯一搜索场景）。搜索结果里的内联文本（存量数据）直接当文本用。
  const lrcUrl = plan.kind === 'url' ? plan.url : await searchLrc();
  if (!lrcUrl) return '';
  if (isInlineLyrics(song.sourceType, lrcUrl)) return lrcUrl;

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
   * 已在队列时**移动**（不复制）——复制会制造「同一首歌在队列出现多次」这个本仓已知坏状态（dnd-kit
   * 的 items.indexOf(id) 对重复项索引歧义）。
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

// --- URL 预解析缓存 ---统一走 core 预取缓存（键 = `sourceType:id`，30min TTL，失败可遗忘）。
// 桌面曾自建模块级 Map：无 TTL、失败不失效，带签名的过期直链会被无期限复用并直接喂给 Howler（
// onloaderror）——同一份语义不能存在两套规则。

/**
 * **#390 修正**：解析必须经 `musicApi:call` 落到**主进程**那份 `prefetchCache`——播放解析经 IPC 读
 * 的是主进程的模块实例，渲染层自己写的那份没人读（此前`resolvePlayableSongRouted` + 本地 
 * `setPrefetchedUrl` 的写法等于空转）。
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
/**
 * 随机序同步（#639 C1）——**薄封装** `queueState.planQueueState`。语义已收进 `queueState.ts`（游标怎么跟、何时重洗、
 * 何时不建序列都在那一处）。**新代码请直接用 `applyQueueState`**（它同时产出 index，避免下标与随机序分开写）。
 */
function syncShuffle(
  state: PlayerStoreState,
  playlist: Song[],
  cursorIndex: number,
  options: { reseed?: boolean; replaceId?: { from: string; to: string }; ensure?: boolean } = {},
): ShuffleState | null {
  const policy = options.replaceId
    ? 'replace-id'
    : options.reseed
      ? 'reseed'
      : options.ensure
        ? 'locate'
        : 'align';
  return planQueueState(
    { playlist: state.currentPlaylist, index: cursorIndex, shuffle: state.shuffle, playMode: state.playMode },
    { playlist, index: cursorIndex, policy, replaceId: options.replaceId },
  ).shuffle;
}

/**
 * 应用一次队列状态转移（#639 C1）：规划 + set。
 * **调用点只描述变更意图**——`planQueueState` 同时产出 `playlist` / `index` / `shuffle` 三元组，调用方没有机会把下标与随机序配错
 * （那正是本仓修过三次的 bug 形状）。落盘不在这里：store 订阅是唯一出口。
 */
function applyQueueState(
  set: (patch: Partial<PlayerStoreState>) => void,
  state: PlayerStoreState,
  change: Parameters<typeof planQueueState>[1],
): void {
  const next = planQueueState(
    { playlist: state.currentPlaylist, index: state.currentPlaylistIndex, shuffle: state.shuffle, playMode: state.playMode },
    change,
  );
  set({
    currentPlaylist: next.playlist,
    currentPlaylistIndex: next.index,
    shuffle: next.shuffle,
  });
}

/**
 * next / prev 的**落点**（#555）：随机模式下先把序列对到当前播放曲——没有序列就现洗一份
 * （`ensure`，防脏数据导致游标漂移），再把对齐后的序列作为入参交给 core `planAdvance`。
 * **落点与 effect 只在 core 一处决定**，宿主只执行 effect；非随机模式序列原样传入。
 */
function planAdvanceFromCurrent(state: PlayerStoreState, direction: 1 | -1): AdvancePlan {
  const shuffle = state.playMode === '随机播放'
    ? syncShuffle(state, state.currentPlaylist, state.currentPlaylistIndex, { ensure: true })
    : state.shuffle;
  return planAdvance({
    queue: state.currentPlaylist,
    currentIndex: state.currentPlaylistIndex,
    playMode: state.playMode,
    shuffle,
    direction,
  });
}

/**
 * 执行 core `planAdvance` 给出的 effect（#555）：宿主只负责「怎么落」。
 * - `restart-current`：目标是当前曲 → seek(0) 重播，**不重新解析 URL**（避免切走 → reload 的音轨
 * 闪烁，桌面既有行为）；- `load-target`：换下标并按主链路加载播放。
 */
function applyAdvanceEffect(
  plan: AdvancePlan,
  context: {
    currentSong: Song | null;
    playlist: Song[];
    set: (patch: Partial<PlayerStoreState>) => void;
    play: (song: Song) => void;
  },
): void {
  const { currentSong, playlist, set, play } = context;
  if (plan.effect === 'restart-current') {
    if (!currentSong) return;
    audioPlayer.seek(0);
    audioPlayer.play();
    playbackClock.setPosition(0);
    set({ isPlaying: true, error: null, currentPlaylistIndex: plan.index, shuffle: plan.shuffle });
    return;
  }
  set({ currentPlaylistIndex: plan.index, shuffle: plan.shuffle });
  play(playlist[plan.index]);
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
 * C2 解析模块的桌面端口（#639 C2）：把 IPC 与「试听版」的 UI 副作用接进去。
 * 解析逻辑本身不认识 store / IPC，因此可零 mock 单测（见 `__tests__/resolvePlaybackUrl.test.ts`）。
 */
const desktopResolveDeps: ResolvePlaybackUrlDeps = {
  resolveRouted: (song) => callMusicApi('resolvePlayableSongRouted', song),
  sodaPlayableUrl: (songId) => callMusicApi('getSodaPlayableUrl', songId),
  // #390：遗忘必须打到主进程那份缓存（渲染层那份没人读）
  forgetPrefetched: async (song) => { await callMusicApi('forgetPrefetchedSong', song); },
  explainFailure: (song) => callMusicApi('explainPlaybackFailure', song).catch(() => null),
  onNonFull: (song) => {
    console.warn(`[player] 《${song.name}》解析结果为试听版（non-full），可换源获取完整版`);
    // preview 立即播直连试听（秒出声），不再等 tier3
    useSearchStore.getState().setAudioTag(song.id, 'preview');
    message.info('当前为试听版，可换源获取完整版');
  },
  log: (level, message) => console[level === 'warn' ? 'warn' : 'error'](message),
};

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
 * 文案一律取 `decision.copy`。
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
  // #639 C1：走同一处规划器（原先手写 set，是 `syncShuffle` 的另一个入口）
  const nextState = planQueueState(
    { playlist: store.currentPlaylist, index: store.currentPlaylistIndex, shuffle: store.shuffle, playMode: store.playMode },
    { playlist: store.currentPlaylist, index: next.index, policy: 'locate' },
  );
  usePlayerStore.setState({ currentPlaylistIndex: nextState.index, shuffle: nextState.shuffle });
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
      // #639 R3.3：落点也要跟着走。此前只换 currentSong，`currentPlaylistIndex` 与随机游标
      // 仍指上一首 —— 恢复网络后按「下一首」会从**旧位置**推进（跳回已播过的位置）。
      // 口径与下方正常路径的队列同步段一致（队列外点歌 → 追加进队并置尾）。
      const playlist = get().currentPlaylist;
      const at = playlist.findIndex(s => s.id === song.id);
      // 队列外点歌 → 追加进队并置尾；否则只改落点。两者都走同一处规划器。
      const nextPlaylist = at === -1 ? [...playlist, song] : playlist;
      const nextIndex = at === -1 ? nextPlaylist.length - 1 : at;
      const nextState = planQueueState(
        { playlist, index: get().currentPlaylistIndex, shuffle: get().shuffle, playMode: get().playMode },
        { playlist: nextPlaylist, index: nextIndex, policy: 'locate' },
      );
      set({
        error: OFFLINE_COPY, isLoading: false, isPlaying: false, currentSong: song,
        currentPlaylist: nextState.playlist,
        currentPlaylistIndex: nextState.index,
        shuffle: nextState.shuffle,
      });
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

      // #639 C2：解析腿收进零副作用模块（`services/resolvePlaybackUrl`）——
      // 分支（本地 / 汽水 / 路由链）与失败归因都在那里，这里只管编排。
      // 该模块不抛错：失败以 `url` 为空 + `advice` 表达，异常语义留在这一层。
      const resolved = await resolvePlaybackUrl(song, desktopResolveDeps, { fresh });
      const realUrl = resolved.url;
      const playbackNonFull = resolved.nonFull;

      // 现在 core 的两个分支（空串 / 抛错）都落到同一条尾巴并写回预取缓存，桌面不需要任何适配器，删
      // 掉整块（含那次保证落空的二次搜索）。
      if (generation !== playGeneration) {
        set({ isLoading: false });
        return;
      }

      if (!realUrl) {
        set({ isLoading: false });
        // 「不可播」徽标回写与重试 / 跳歌决策统一在 handlePlaybackFailure；
        // 归因文案由 C2 模块取（core 单一来源），这里只负责把它包成异常 ——
        // `failureReasonText` 靠 `instanceof` 区分「解析链穷尽」与「播放器/网络失败」。
        throw new PlayableUrlMissingError(resolved.advice);
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
      // #639 C1：队列外点歌 → 追加进队并置尾；否则只改落点。同一处规划器 'locate'。
      const nextPlaylist = index === -1 ? [...playlist, song] : playlist;
      const nextIndex = index === -1 ? nextPlaylist.length - 1 : index;
      applyQueueState(set, get(), { playlist: nextPlaylist, index: nextIndex, policy: 'locate' });

      // 预取必须放在队列 index 同步之后（#318）：手动点播路径（QueuePage 双击行、历史/本地/发现页单
      // 曲点播）不先同步 index，若在 set({ currentSong }) 后立即预取，会基于「新 currentSong + 旧 
      // index」算出刚开播的这首歌自己——当前歌被重复解析、真正的下一首漏预取。
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
    // 两种来源——冷启还原态（渲染层从队列还原了歌，传输层还在 idle）与上次加载失败（error，howl 仍
    // 在但已死）。
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
    set((state) => {
      // #639 C1：同一处规划器；「序列保留、游标归位（-1）」由 policy 'align' 表达
      const next = planQueueState(
        { playlist: state.currentPlaylist, index: state.currentPlaylistIndex, shuffle: state.shuffle, playMode: state.playMode },
        { playlist: state.currentPlaylist, index: -1, policy: 'align' },
      );
      return { currentSong: null, isPlaying: false, currentPlaylistIndex: next.index, shuffle: next.shuffle };
    });
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
    set((state) => {
      // 进随机：把游标对到当前曲（没有序列就现洗一份）；换回列表/单曲：序列保留但不参与。
      // `planQueueState` 收 `playMode` 入参，不再靠「把新模式塞进 state 副本」的老技巧
      // （那个技巧的存在本身就是「模式与序列的判定散在闭包里」的症状）。
      if (mode !== '随机播放') return { playMode: mode, shuffle: state.shuffle };
      const next = planQueueState(
        { playlist: state.currentPlaylist, index: state.currentPlaylistIndex, shuffle: state.shuffle, playMode: mode },
        { playlist: state.currentPlaylist, index: state.currentPlaylistIndex, policy: 'mode', playMode: mode },
      );
      return { playMode: mode, shuffle: next.shuffle };
    });
    persistPlayMode(mode);
  },

  playNext: () => {
    const { currentPlaylist, currentPlaylistIndex } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      get().stop();
      return;
    }

    // #555：随机 / 单曲 / 列表三条路统一由 core planAdvance 决定落点与 effect
    // （此前随机与单曲各有一条提前 return 的旁路，effect 契约对桌面不成立），
    // 这里只按 effect 落：restart-current 走 seek(0) 复播、不重新解析（桌面既有行为）。
    const plan = planAdvanceFromCurrent(get(), 1);
    if (plan.effect === 'none') {
      get().stop();
      return;
    }
    applyAdvanceEffect(plan, {
      currentSong: get().currentSong,
      playlist: currentPlaylist,
      set,
      play: get().play,
    });
  },

  playPrevious: () => {
    const { currentPlaylist, currentPlaylistIndex } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      return;
    }

    // #555：与 playNext 同一条路（此前随机分支自己 stepShuffle 后提前 return）；
    // 单曲循环 + prev = 回上一首（不重播），单元素队列 = restart-current，均由 core 决定。
    const plan = planAdvanceFromCurrent(get(), -1);
    if (plan.effect === 'none') return;
    applyAdvanceEffect(plan, {
      currentSong: get().currentSong,
      playlist: currentPlaylist,
      set,
      play: get().play,
    });
  },

  insertNext: async (song: Song) => {
    const { currentPlaylist, currentPlaylistIndex, currentSong, playMode } = get();

    // 队列为空：没有「下一首」这个位置，等价于「开始播放这首」
    // #639 C1：与「新建队列」同一条路（policy 'reseed'）——随机模式下现洗一份，非随机保持 null
    if (currentPlaylist.length === 0) {
      applyQueueState(set, get(), { playlist: [song], index: 0, policy: 'reseed' });
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
      const base = syncShuffle(get(), nextQueue, currentPlaylistIndex, { ensure: true });
      const nextShuffle = base ? insertNextInShuffle(base, nextQueue, song.id, currentPlaylistIndex) : null;
      // #639 C1：core 算好的序列是**权威值** → policy 'settle' 原样接受（不再二次推导游标）
      applyQueueState(set, get(), {
        playlist: nextQueue, index: currentPlaylistIndex, policy: 'settle', settled: nextShuffle,
      });

      if (existingIndex === -1 && !currentSong) await get().play(song);
      return;
    }

    // 幂等：它已经在「当前曲之后」这一位 → 什么都不做（连点两次结果稳定、队列长度不变）
    if (existingIndex === currentPlaylistIndex + 1) return;
    // #639 R3.1：点的是**当前播放曲本身** → no-op（与随机分支 `song.id === currentId` 同口径）。缺这条守卫会落进移动分支，
    // 把当前曲往后挪一格而 `currentPlaylistIndex` 不动——指针与当前曲脱节，再按「下一首」会重复加载正在播的这首。
    if (existingIndex === currentPlaylistIndex) return;

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
    applyQueueState(set, get(), { playlist: nextQueue, index: nextIndex, policy: 'align' });

    // 队列里没这首、且当前没有在播的曲目 → 直接开始播它（有在播的曲子则**绝不打断**，这是本动作的核心承诺）
    if (existingIndex === -1 && !currentSong) await get().play(song);
  },

  setCurrentPlaylist: (playlist: Song[], currentIndex: number = -1) => {
    // #639 C1：整批换队列（id 集合变了才重洗）
    applyQueueState(set, get(), { playlist, index: currentIndex, policy: 'reseed' });
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
    const locIdx = currentSong?.id === originalId ? idx : currentPlaylistIndex;
    applyQueueState(set, get(), {
      playlist: queue,
      index: locIdx,
      policy: 'replace-id',
      replaceId: { from: originalId, to: swapped.id },
    });

    if (currentSong?.id === originalId) {
      set({ currentSong: swapped });
      await get().play(swapped);
    }
  },

  removeFromQueue: (index: number) => {
    const { currentPlaylist, currentPlaylistIndex, playMode, shuffle } = get();
    if (index < 0 || index >= currentPlaylist.length) return;

    const newPlaylist = currentPlaylist.filter((_, i) => i !== index);

    if (newPlaylist.length === 0) {
      get().stop();
      return;
    }

    if (index === currentPlaylistIndex) {
      // 移除的是当前播放歌曲 → 续播它的「下一首」。#639 R3.2：随机模式下「下一首」是**随机序**里的后继（队列页显示的就是随机序，
      // 用户看到当前行下面是 D 就该播 D）；此前一律取成员序邻居 `newPlaylist[index]`，播出的歌与界面显示不符。
      let resumedIndex = index < newPlaylist.length ? index : 0;
      if (playMode === '随机播放' && shuffle) {
        // 在**旧**队列上把游标对到当前曲、前进一格，拿到后继 id，再在新队列里定位
        const stepped = stepShuffle(
          alignShuffleOrder(shuffle, currentPlaylist, index),
          currentPlaylist,
          1,
        );
        const nextId = stepped.index >= 0 ? currentPlaylist[stepped.index]?.id : undefined;
        const at = nextId ? newPlaylist.findIndex(s => s.id === nextId) : -1;
        if (at >= 0) resumedIndex = at;
      }
      const nextSong = newPlaylist[resumedIndex] || newPlaylist[0];
      // #639 C1：游标与下标一起产出（原先是 syncShuffle + set 两处分开写）
      applyQueueState(set, get(), { playlist: newPlaylist, index: resumedIndex, policy: 'align' });
      get().play(nextSong);
      return;
    }

    // 删非当前曲：下标平移与游标同步**原子产出**（`removeAt` 不让人把两者配错）
    const removed = removeAt(currentPlaylist, index, currentPlaylistIndex);
    // #639 C1：下标平移（removeAt）与游标同步由同一处规划器原子产出
    applyQueueState(set, get(), { playlist: removed.playlist, index: removed.index, policy: 'align' });
  },

  reorderQueue: (fromIndex: number, toIndex: number) => {
    const { currentPlaylist, currentPlaylistIndex } = get();
    if (fromIndex < 0 || fromIndex >= currentPlaylist.length) return;
    if (toIndex < 0 || toIndex >= currentPlaylist.length) return;
    if (fromIndex === toIndex) return;

    // #639 C1：数组数学（moveItem）与「当前曲下标随移动平移」的数学合在 `moveTo` 里
    // **原子产出** —— 原先把这两份分开写（moveItem + 三分支），是「下标变了、游标没跟」的温床。
    const moved = moveTo(currentPlaylist, fromIndex, toIndex, currentPlaylistIndex);
    applyQueueState(set, get(), { playlist: moved.playlist, index: moved.index, policy: 'align' });
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

    // 索引数学与列表拖拽共用 moveItem（「列表索引数学只此一份」）；游标归规划器对到当前曲
    // #639 C1：序列类变体——调用方只给新顺序，游标与成员序由 planner 一并产出
    applyQueueState(set, get(), {
      playlist: currentPlaylist,
      index: currentPlaylistIndex,
      policy: 'reorder-shuffle',
      order: moveItem(normalized.order, fromIndex, toIndex),
    });
  },

  clearQueue: () => {
    // 先停传输层（stop() 只停播、队列保留），再走**终止类**变体把队列本身也收掉
    get().stop();
    // #639 C1：成员清空 + 下标 -1 + 序列作废由 planner 一次产出（入参被忽略，终态固定）
    applyQueueState(set, get(), { playlist: [], index: -1, policy: 'clear' });
  },
}));

/**
 * 队列落盘的**单一出口**（#639 C1）：此前 16 个 action 各写一遍 `persistQueue(...)`，新增 action 忘写一次就静默丢落盘
 * （移动端早已是订阅单一出口，这里对齐它）。只在**队列这三份数据**真的变化时写，`currentSong` / `isPlaying` 等高频字段不落盘。
 */
let lastPersisted = { playlist: usePlayerStore.getState().currentPlaylist, index: usePlayerStore.getState().currentPlaylistIndex, shuffle: usePlayerStore.getState().shuffle };
usePlayerStore.subscribe((state) => {
  if (
    state.currentPlaylist === lastPersisted.playlist &&
    state.currentPlaylistIndex === lastPersisted.index &&
    state.shuffle === lastPersisted.shuffle
  ) return;
  lastPersisted = { playlist: state.currentPlaylist, index: state.currentPlaylistIndex, shuffle: state.shuffle };
  persistQueue(state.currentPlaylist, state.currentPlaylistIndex, state.shuffle);
});

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
