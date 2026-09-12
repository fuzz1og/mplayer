import { create } from 'zustand';
import { message } from 'antd';
import { getGlobalPlayer, destroyGlobalPlayer, type PlayerState } from '@/renderer/services/audioPlayer';
import { playbackClock } from '@/renderer/services/playbackClock';
import type { Song } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';
import {
  findExactMatch,
  getNextSongIndex,
  getPrevSongIndex,
  songUsesSongidLyrics,
  isSodaSource,
  isInlineLyrics,
  forgetPrefetchedUrl,
  getPrefetchedUrl,
  setPrefetchedUrl,
} from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { moveItem } from '@/renderer/utils/reorder';
import { getNextSong, persistQueue, loadQueue, getInitialPlayMode, persistPlayMode } from '@/renderer/utils/queueUtils';
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
  // 网易歌词已内聚进内容能力（#242 fillLyrics）：Song.lrc 即 LRC 文本，直接用
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
  // 歌词为空时搜索补全：网易搜索兜底返回的也是内联文本（#242）；汽水搜索恒空，
  // 跳过（分享页按 trackId 直取 getSodaLyrics）；其余源返回取词 URL
  if (!lrc && !songUsesSongidLyrics(song.sourceType)) {
    lrc = await searchLrc();
  }
  // 搜索兜底命中的内联文本（网易）直接返回
  if (lrc && isInlineLyrics(song.sourceType, lrc)) return lrc;

  const lrcUrl = lrc;
  if (!lrcUrl) {
    // 汽水：分享页免登录结构化歌词（searchSongsSoda 不带 lrc，track_v2 需登录态，
    // 分享页 _ROUTER_DATA.lyrics.sentences 免登录可拿，getSodaLyrics 转 LRC 文本）
    if (isSodaSource(song.sourceType) && song.id) {
      return callMusicApi('getSodaLyrics', String(song.id));
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
}

/** play() 内部选项：fresh = 换新 URL 重试；failureCount = 本次失败链已跳过的曲目数 */
export interface PlaybackOptions {
  fresh?: boolean;
  failureCount?: number;
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
  setCurrentPlaylist: (playlist: Song[], currentIndex?: number) => void;
  replaceQueueSong: (originalId: string, swapped: Song) => Promise<void>;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
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
 * 获取队列中下一首歌（不改变播放状态）
 * 导出供测试使用
 */
export function getNextSongInQueue(state: PlayerStoreState): Song | null {
  return getNextSong(state.currentPlaylist, state.currentPlaylistIndex, state.playMode, state.currentSong);
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

  // 已有未过期条目（core 30min TTL）→ 播放时 core 内部 0 等待命中，无需重解析
  if (getPrefetchedUrl(nextSong)) return;

  // T12：带试听版检测的播放解析（nonFull 标记）；预取只关心 URL。
  // #171 后列表歌 url 恒为空串，缓存键由 core 按 sourceType:id 推导。
  callMusicApi('resolvePlayableSongRouted', nextSong)
    .then((resolved: { url: string; nonFull: boolean }) => {
      if (resolved?.url) {
        setPrefetchedUrl(nextSong, resolved.url, !!resolved.nonFull);
      }
    })
    .catch(() => {});
}

// --- 播放失败处理（对齐移动端 packages/mobile/services/audioPlayer.ts） ---
/**
 * 单次播放尝试的上下文。同一次 load 失败会同时触发 audioPlayer 回调与
 * play() 的 catch，用 handled 去重，保证一次失败只跑一轮「重试 / 跳歌」。
 */
interface PlayAttempt {
  songId: string;
  fresh: boolean;
  failureCount: number;
  handled: boolean;
}

let activeAttempt: PlayAttempt | null = null;

/** 失败原因归类（提示文案）：解析链穷尽 vs 播放器 / 网络 */
function failureReasonText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes('无法获取音频 URL') ? '直连与全部订阅源均未命中' : '音源解析失败';
}

/**
 * 统一失败处理：
 * 1) 同曲 fresh 重试一次（先遗忘失败直链，再重走直连 → tier3）；
 * 2) 仍失败 → 回写「不可播」徽标并自动跳下一首；
 * 3) 没有别的歌 / 连续失败达队列长度 → 停止并提示（防整列表死链无限连跳）。
 * 本地文件不会过期：不做 fresh 重试，失败直接跳。
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
    forgetPrefetchedUrl(song);
    await store.play(song, { fresh: true, failureCount: attempt.failureCount });
    return;
  }

  if (song.sourceType !== 'local') {
    useSearchStore.getState().setAudioTag(song.id, 'invalid');
  }

  const nextIndex = getNextSongIndex(store.currentPlaylist, store.currentPlaylistIndex, store.playMode);
  const nextSong = nextIndex >= 0 ? store.currentPlaylist[nextIndex] : null;
  const noOtherSong = !nextSong || nextSong.id === song.id;
  const exhausted = attempt.failureCount + 1 >= store.currentPlaylist.length;

  if (noOtherSong || exhausted) {
    audioPlayer.stop();
    usePlayerStore.setState({
      error: error instanceof Error ? error.message : '播放失败',
      isLoading: false,
      isPlaying: false
    });
    message.error(
      noOtherSong
        ? `《${song.name}》${reasonText}，且队列中没有其他歌曲，可尝试换源`
        : `连续 ${attempt.failureCount + 1} 首无法播放，已暂停（试试换源）`
    );
    return;
  }

  usePlayerStore.setState({ currentPlaylistIndex: nextIndex });
  message.warning(`《${song.name}》${reasonText}，已自动跳到下一首`);
  await store.play(nextSong, { failureCount: attempt.failureCount + 1 });
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

  play: async (song: Song, options: PlaybackOptions = {}) => {
    const { fresh = false, failureCount = 0 } = options;
    const { isLoading, currentSong } = get();

    if (isLoading && currentSong?.id === song.id) {
      return;
    }

    const generation = ++playGeneration;
    audioPlayer.cancelLoad();
    // 登记本次尝试：load 失败会同时触发 audioPlayer 回调与下方 catch，靠 attempt 去重
    const attempt: PlayAttempt = { songId: song.id, fresh, failureCount, handled: false };
    activeAttempt = attempt;
    /** 是否已真正开始播放：用于区分「播放失败」与「播放后簿记异常」 */
    let playStarted = false;

    try {
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
        // 0 等待命中只会原地连败两次（core 预取缓存 30min TTL + 失败可遗忘）
        if (fresh) forgetPrefetchedUrl(song);
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
        // 「不可播」徽标回写与重试 / 跳歌决策统一在 handlePlaybackFailure
        throw new Error('无法获取音频 URL：可能为 VIP/无版权或直连暂不可用，可尝试换源');
      }

      const songWithRealUrl = { ...song, url: realUrl };
      await audioPlayer.load(songWithRealUrl);

      if (generation !== playGeneration) {
        set({ isLoading: false });
        return;
      }

      audioPlayer.play();
      playStarted = true;

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
        set({
          currentPlaylist: newPlaylist,
          currentPlaylistIndex: newPlaylist.length - 1
        });
      } else {
        set({ currentPlaylistIndex: index });
      }
      persistQueue(get().currentPlaylist, get().currentPlaylistIndex);

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
    audioPlayer.play();
    set({ isPlaying: true });
  },

  stop: () => {
    audioPlayer.stop();
    playbackClock.reset();
    set({
      currentSong: null,
      isPlaying: false,
      currentPlaylistIndex: -1
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
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
    set({ playMode: mode });
    persistPlayMode(mode);
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

    // 随机 / 列表循环统一收敛到 core getNextSongIndex（防重复随机、列表回绕）
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

    // 随机 / 单曲循环 / 列表循环统一收敛到 core getPrevSongIndex
    // （随机防重复、单曲不做重播、列表回绕——与现有行为一致）
    const prevIndex = getPrevSongIndex(currentPlaylist, currentPlaylistIndex, playMode);
    if (prevIndex === -1) return;
    set({ currentPlaylistIndex: prevIndex });
    get().play(currentPlaylist[prevIndex]);
  },

  setCurrentPlaylist: (playlist: Song[], currentIndex: number = -1) => {
    set({
      currentPlaylist: playlist,
      currentPlaylistIndex: currentIndex
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
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

    if (currentSong?.id === originalId) {
      set({ currentPlaylist: queue, currentPlaylistIndex: idx, currentSong: swapped });
      persistQueue(queue, idx);
      await get().play(swapped);
    } else {
      set({ currentPlaylist: queue });
      persistQueue(queue, currentPlaylistIndex);
    }
  },

  removeFromQueue: (index: number) => {
    const { currentPlaylist, currentPlaylistIndex } = get();
    if (index < 0 || index >= currentPlaylist.length) return;

    const newPlaylist = currentPlaylist.filter((_, i) => i !== index);
    let newIndex = currentPlaylistIndex;

    if (newPlaylist.length === 0) {
      get().stop();
      persistQueue([], -1);
      return;
    }

    if (index === currentPlaylistIndex) {
      // 移除的是当前播放歌曲，播放下一首
      const nextSong = newPlaylist[index] || newPlaylist[0];
      set({
        currentPlaylist: newPlaylist,
        currentPlaylistIndex: index < newPlaylist.length ? index : 0,
      });
      persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
      get().play(nextSong);
      return;
    }

    if (index < currentPlaylistIndex) {
      newIndex = currentPlaylistIndex - 1;
    }

    set({
      currentPlaylist: newPlaylist,
      currentPlaylistIndex: newIndex,
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
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

    set({
      currentPlaylist: newPlaylist,
      currentPlaylistIndex: newIndex,
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
  },

  clearQueue: () => {
    get().stop();
    set({
      currentPlaylist: [],
      currentPlaylistIndex: -1,
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
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
