import { create } from 'zustand';
import { musicApi, parseLRC, planLyricsFetch } from '@mplayer/core';
import type { LyricLine, Song } from '@mplayer/core';
import { fetchLrcInBackground } from '../services/audioPlayer';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useLogsStore } from './logsStore';

/**
 * 宿主级歌词源（#775）：全屏播放器与 Android 浮窗推送共用同一份 `planLyricsFetch` 结果。
 * 取词决策仍在 core；这里只做 I/O 与「切歌先清旧词」的可见性语义（规格 §3.2 / §4.2）。
 */

interface LyricsState {
  /** 当前 lines 属于哪首歌；null = 无当前曲 */
  songId: string | null;
  lines: LyricLine[];
  loading: boolean;
  loadForSong: (song: Song | null) => void;
}

/** 会话缓存（与旧 PlayerOverlay 内部缓存同口径）：key 由 planLyricsFetch 决定。 */
const lyricCache = new Map<string, LyricLine[]>();
let activeAbort: AbortController | null = null;

export const useLyricsStore = create<LyricsState>()((set) => ({
  songId: null,
  lines: [],
  loading: false,
  loadForSong: (song) => {
    activeAbort?.abort();
    activeAbort = null;

    if (!song) {
      set({ songId: null, lines: [], loading: false });
      return;
    }

    const lyricsT0 = Date.now();
    const plan = planLyricsFetch(song);
    const logKind = () =>
      plan.kind === 'inline'
        ? 'inline(存量)'
        : plan.kind === 'url'
          ? 'url'
          : plan.kind === 'songid'
            ? `songid:${plan.source}`
            : 'none';
    const cacheKey = plan.kind === 'inline'
      ? `inline:${song.id}`
      : plan.kind === 'url'
        ? plan.url
        : plan.kind === 'songid'
          ? `songid:${song.id}`
          : '';

    if (!cacheKey) {
      set({ songId: song.id, lines: [], loading: false });
      // 热榜点播的搜索腿可能未命中（lrc 空）→ 后台搜索补 lrc，回填后宿主重新加载
      void fetchLrcInBackground(song, true);
      return;
    }

    const cached = lyricCache.get(cacheKey);
    if (cached) {
      set({ songId: song.id, lines: cached, loading: false });
      useLogsStore.getState().addLog(
        'info',
        `[耗时] 歌词就绪(会话缓存): 《${song.name}》 ${Date.now() - lyricsT0}ms · ${logKind()} · ${cached.length} 行`,
      );
      return;
    }

    // 切歌 / 新词未就绪：清旧词并等待（§4.2），绝不让上一首的最后一行残留在浮窗
    set({ songId: song.id, lines: [], loading: true });
    const load = plan.kind === 'inline'
      ? Promise.resolve(plan.text)
      : plan.kind === 'url'
        ? musicApi.getLyrics(plan.url)
        : plan.kind === 'songid'
          ? plan.source === 'soda'
            ? musicApi.getSodaLyrics(plan.id)
            : musicApi.getNeteaseLyrics(plan.id)
          : Promise.resolve('');
    const abort = new AbortController();
    activeAbort = abort;
    load.then((lrc) => {
      if (abort.signal.aborted) return;
      const parsed = parseLRC(lrc);
      lyricCache.set(cacheKey, parsed.lines);
      set({ songId: song.id, lines: parsed.lines, loading: false });
      useLogsStore.getState().addLog(
        'info',
        `[耗时] 歌词就绪: 《${song.name}》 ${Date.now() - lyricsT0}ms · ${logKind()} · ${parsed.lines.length} 行`,
      );
      // 空词（URL 被拒 / 无词）≠ 加载失败：非网易源再给搜索兜底一次；同 URL 时内部无变化返回
      if (parsed.lines.length === 0 && song.sourceType !== 'netease') {
        void fetchLrcInBackground(song, true);
      }
    }).catch(() => {
      if (abort.signal.aborted) return;
      set({ songId: song.id, lines: [], loading: false });
      // 歌曲自带 lrc URL 可能已失效 → 强制搜索兜底补歌词
      void fetchLrcInBackground(song, true);
    });
  },
}));

let hostStarted = false;
let lastSignature: string | null = null;

/**
 * 宿主级订阅：全屏播放器未挂载时也要为浮窗取词（规格 §3.2「不只存在于 PlayerOverlay 挂载期」）。
 * 与旧行为一致：UI 播放器打开或浮窗开关打开才真正取词。
 */
export function initLyricsHost(): void {
  if (hostStarted) return;
  hostStarted = true;

  const refresh = () => {
    const { currentSong, showPlayer } = usePlayerStore.getState();
    const overlayWanted = useSettingsStore.getState().floatingLyricsEnabled;
    if (!showPlayer && !overlayWanted) return;
    const signature = currentSong ? `${currentSong.id}|${currentSong.lrc ?? ''}` : 'none';
    if (signature === lastSignature) return;
    lastSignature = signature;
    useLyricsStore.getState().loadForSong(currentSong);
  };

  usePlayerStore.subscribe(refresh);
  useSettingsStore.subscribe(refresh);
  refresh();
}
