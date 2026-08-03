import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioStatus } from 'expo-audio';
import type { EventSubscription } from 'expo-modules-core';
import Constants from 'expo-constants';
import { cacheManager, getNextSongIndex, musicApi, resolvePlayableSong, resolveFreshUrl } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { useLogsStore } from '../stores/logsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { updateNotification, clearNotification } from './notificationService';
import { getCachedUrl, setCachedUrl } from './cacheService';
import { searchStrictMatch } from './songResources';

type Player = ReturnType<typeof createAudioPlayer>;

// Expo Go 未启用 expo-audio 的 background playback 配置插件，
// 锁屏控制/后台播放不可用，跳过 setActiveForLockScreen 避免报错刷屏
const isExpoGo = Constants.expoGoConfig !== null;

// 追踪所有创建过的播放器：expo-audio 的原生释放是异步的，
// remove() 后旧播放器可能仍在出声，切换前必须逐个显式暂停。
const livePlayers = new Set<Player>();
let player: Player | null = null;
let playerStatusSubscription: EventSubscription | null = null;
let currentPlayId = 0;
// playSong 进行中（解析 URL/创建播放器）：togglePlay 应忽略点击，
// 避免 URL 解析期间反复触发 fresh 重试解析
let preparingPlayback = false;

export async function initAudio(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

/**
 * 暂停并释放所有已创建的播放器。
 * 每个操作独立 try/catch，保证：
 * 1) 切歌时旧音频一定停止（先 pause() 同步停音），不会两首歌同时在播；
 * 2) remove() 在异常状态下抛错也不会中断后续播放、不会留下僵尸引用。
 * pause 必须 await：expo-audio 原生暂停是异步的，不等待就创建新播放器，
 * 旧播放器可能仍在出声（换源/切歌时表现为两首歌同时播放）。
 */
async function stopAllPlayers(): Promise<void> {
  for (const p of livePlayers) {
    try { await p.pause(); } catch {}
    try { p.remove(); } catch {}
  }
  livePlayers.clear();
  player = null;
  playerStatusSubscription?.remove();
  playerStatusSubscription = null;
}

function nextSongAfterError(retryCount: number): Song | null {
  const s = usePlayerStore.getState();
  if (retryCount + 1 >= s.queue.length) return null;
  return s.next();
}

/**
 * 播放失败后为同一首歌获取全新可播 URL（core 的 fresh 重试语义）。
 * 收藏/历史里的 url 可能已过期（音乐源直链一般数小时失效）。
 */
async function refreshPlayableUrl(song: Song): Promise<string> {
  return resolveFreshUrl(song, {
    ...musicApi,
    clearAudioUrlCache: () => cacheManager.clearByPrefix('audioUrl'),
  });
}

/**
 * 后台补歌词/封面：**懒刷新**——播放时只用歌曲自带资源，不主动搜索；
 * 仅当歌曲 lrc 为空（专辑/歌单歌）或加载失败（force，PlayerOverlay 歌词
 * onError、PlayerBar/PlayerOverlay 封面 onError 触发）才搜索补全。
 * 避免每次播放都搜索导致封面/歌词 URL 伪刷新（迷你播放栏图片反复重载）。
 */
export async function fetchLrcInBackground(song: Song, force = false): Promise<void> {
  const log = useLogsStore.getState();
  if ((!force && song.lrc) || song.sourceType === 'local' || !song.name) return;
  try {
    const fresh = await searchStrictMatch(song);
    if (!fresh) return;
    const cur = usePlayerStore.getState().currentSong;
    if (cur?.id !== song.id) return; // 已切歌，丢弃过期结果
    // 归一化比较：302 端点的 t 时间戳参数每次搜索都不同，不算资源变化
    const lrcChanged = !!fresh.lrc && resourceUrlKey(fresh.lrc) !== resourceUrlKey(cur.lrc);
    const coverChanged = !!fresh.cover?.startsWith('http') && resourceUrlKey(fresh.cover) !== resourceUrlKey(cur.cover);
    if (!lrcChanged && !coverChanged) return; // 资源仍有效，无需刷新
    // 预取歌词文本（core 歌词缓存预热，全屏播放器打开秒显）
    if (lrcChanged) void musicApi.getLyrics(fresh.lrc).catch(() => {});
    usePlayerStore.setState({
      currentSong: {
        ...cur,
        lrc: lrcChanged ? fresh.lrc : cur.lrc,
        cover: coverChanged ? fresh.cover : cur.cover,
      },
    });
    log.addLog('info', `歌曲资源刷新: 《${song.name}》${coverChanged ? '封面' : ''}${lrcChanged ? '歌词' : ''}`);
  } catch (e: any) {
    log.addLog('warn', `歌曲资源刷新失败: 《${song.name}》${e?.message || e}`);
  }
}

/**
 * 判断是否为摄取端点的 302 跳转地址（api.php?get=url...）。
 * 这类地址播放器请求时要先到摄取端点再 302 到 CDN，两跳慢加载；
 * 提前在 JS 层解析成 CDN 直链（结果进缓存，重复播放秒开）。
 */
function isRedirectEndpoint(url: string): boolean {
  return url.includes('api.php?get=url');
}

/** 解析 302 端点 → CDN 直链（getAudioUrl 带缓存；直链直接返回原值） */
async function resolveDirectUrl(url: string): Promise<string> {
  // 1.5s 超时：解析失败（网络/源临时故障）直接用原 URL（302 播放器能播，只是慢）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const direct = await musicApi.getAudioUrl(url, controller.signal);
    return direct?.startsWith('http') ? direct : url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 资源 URL 归一化 key：302 端点的 t 时间戳参数每次搜索都不同，
 * 但内容相同——比较资源是否变化时忽略它，避免每次播放都触发
 * 封面/歌词"伪刷新"（迷你播放栏图片反复重载）。
 */
function resourceUrlKey(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('t');
    u.searchParams.delete('timestamp');
    return u.href;
  } catch {
    return url;
  }
}

/**
 * 切歌预取：播放成功后，后台并行解析队列下一首的播放 URL（含 302 → 直链），
 * 结果写入 URL 持久化缓存——用户切歌时缓存命中，播放器直连 CDN 秒开。
 */
function prefetchNextSong(): void {
  try {
    const st = usePlayerStore.getState();
    if (st.queue.length === 0 || st.currentIndex < 0) return;
    // 与真实切歌同一套索引逻辑（随机模式预取随机位置，避免总预取同一首）
    const playMode = useSettingsStore.getState().playMode;
    const nextIdx = getNextSongIndex(st.queue, st.currentIndex, playMode);
    if (nextIdx < 0) return;
    const next = st.queue[nextIdx];
    if (!next?.name || next.sourceType === 'local') return;
    void (async () => {
      const resolved = await resolvePlayableSong(next, musicApi);
      const url = isRedirectEndpoint(resolved.url) ? await resolveDirectUrl(resolved.url) : resolved.url;
      if (url?.startsWith('http') && next.id) void setCachedUrl(next.id, next.sourceType || 'netease', url);
      if (resolved.lrc) void musicApi.getLyrics(resolved.lrc).catch(() => {});
    })().catch(() => {});
  } catch {
    // 预取失败不影响播放
  }
}

/**
 * 播放歌曲。
 * @param retryCount 级联跳歌计数（防止全部失效时无限循环）
 * @param fresh 为 true 时绕过原有 url，重新解析全新可播 URL
 */
export async function playSong(song: Song, retryCount = 0, fresh = false): Promise<void> {
  const playId = ++currentPlayId;
  const log = useLogsStore.getState();
  preparingPlayback = true;

  const startPlayback = async (): Promise<void> => {
    let audioUrl: string;
    let lrcUrl = song.lrc || '';
    if (fresh) {
      // 本地文件不会过期，不参与 fresh 重试（调用方已过滤 local 源）
      audioUrl = await refreshPlayableUrl(song);
      // fresh 重试只解析 URL，不返回歌词；歌单/收藏缓存歌 lrc 为空，
      // 后台并行补歌词（否则重试成功播放后歌词永远空白）
      void fetchLrcInBackground(song);
    } else if ((song.url?.startsWith('http') || song.url?.startsWith('file://')) && song.lrc) {
      // 已有完整信息（音频 + 歌词）：零网络直接播放；
      // 302 跳转端点同样先解析成 CDN 直链（两跳慢加载不因有歌词而保留）
      audioUrl = isRedirectEndpoint(song.url) ? await resolveDirectUrl(song.url) : song.url;
    } else if (song.url?.startsWith('http') || song.url?.startsWith('file://')) {
      // 有 url 无歌词：立即播放，歌词后台并行补充（不阻塞播放）
      // 摄取端点 302 跳转先解析成 CDN 直链（播放器直连 CDN，避免两跳慢加载）
      audioUrl = isRedirectEndpoint(song.url) ? await resolveDirectUrl(song.url) : song.url;
      void fetchLrcInBackground(song);
    } else {
      const cached = await getCachedUrl(song.id, song.sourceType || 'netease');
      if (cached) {
        // 缓存命中：秒起；歌词缺失时后台并行补
        audioUrl = isRedirectEndpoint(cached) ? await resolveDirectUrl(cached) : cached;
        void fetchLrcInBackground(song);
      } else {
        // 无 url：合并解析，摄取端点一次拿音频 + 歌词（今日推荐/歌单/歌手页）
        const resolved = await resolvePlayableSong(song, musicApi);
        // 搜索兜底拿到的可能是 302 跳转端点 → JS 层解析成 CDN 直链
        audioUrl = isRedirectEndpoint(resolved.url) ? await resolveDirectUrl(resolved.url) : resolved.url;
        lrcUrl = resolved.lrc;
        // 并行预取歌词文本（core 歌词缓存预热，全屏播放器打开秒显）
        if (lrcUrl) void musicApi.getLyrics(lrcUrl).catch(() => {});
      }
    }
    if (playId !== currentPlayId) throw 'cancelled';
    if (!audioUrl?.startsWith('http') && !audioUrl?.startsWith('file://')) throw new Error('no playable URL');

    // 兜底补歌词：把解析到的歌词 URL 写回 currentSong，触发全屏播放器加载歌词
    if (lrcUrl && !song.lrc) {
      usePlayerStore.setState((s) =>
        s.currentSong?.id === song.id ? { currentSong: { ...s.currentSong, lrc: lrcUrl } } : {}
      );
    }

    const nextPlayer = createAudioPlayer({ uri: audioUrl }, { updateInterval: 250 });
    livePlayers.add(nextPlayer);
    player = nextPlayer;

    // per-player 去重：didJustFinish / error 只处理一次，防止双触发跳歌
    let finished = false;
    let failed = false;

    playerStatusSubscription = nextPlayer.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (playId !== currentPlayId) return;

      if (!status.isLoaded) {
        if (status.error && !failed) {
          failed = true;
          log.addLog('error', `《${song.name}》加载失败: ${status.error}`);
          if (!fresh && song.sourceType !== 'local') {
            // 同一首歌换全新 URL 重试一次（收藏/历史里的 url 可能已过期）；
            // 本地文件不会过期，失败直接跳下一首
            log.addLog('warn', `《${song.name}》将使用新 URL 重试`);
            setTimeout(() => { if (playId === currentPlayId) void playSong(song, retryCount, true); }, 0);
          } else {
            const nextSong = nextSongAfterError(retryCount);
            if (nextSong) {
              log.addLog('warn', `《${song.name}》播放失败，自动跳过`);
              setTimeout(() => { if (playId === currentPlayId) void playSong(nextSong, retryCount + 1, false); }, 0);
            } else {
              // 队列已耗尽：停止假播放并提示
              void stopAllPlayers();
              usePlayerStore.getState().pause();
              log.reportError(`《${song.name}》播放失败，且队列中没有其他歌曲`);
            }
          }
        }
        return;
      }

      const s = usePlayerStore.getState();
      if (status.playing && !s.isPlaying) {
        s.resume();
      } else if (!status.playing && s.isPlaying && !status.didJustFinish) {
        s.pause();
      }

      s.setCurrentTime(status.currentTime);
      s.setDuration(status.duration || 0);

      if (status.didJustFinish && !finished) {
        finished = true;
        const nextSong = s.next();
        if (nextSong) setTimeout(() => {
          if (playId === currentPlayId) void playSong(nextSong, 0, false);
        }, 0);
      }
    });

    if (!isExpoGo) {
      nextPlayer.setActiveForLockScreen(true, {
        title: song.name,
        artist: song.artist,
        albumTitle: song.album,
        artworkUrl: song.cover || undefined,
      });
    }
    nextPlayer.play();

    // 播放 URL 落缓存(24h TTL):下次(含重启后)直接命中,秒起;无 id 的歌不写
    if (audioUrl?.startsWith('http') && song.id) void setCachedUrl(song.id, song.sourceType || 'netease', audioUrl);

    log.addLog('info', `开始播放《${song.name}》- ${song.artist}${fresh ? '（新URL重试）' : ''}`);
    useHistoryStore.getState().addHistory(song);
    void updateNotification(song, true).catch(() => {});
    // 预取下一首直链（切歌秒开）
    prefetchNextSong();
  };

  try {
    await stopAllPlayers();
    await startPlayback();
  } catch (err) {
    if (err === 'cancelled') return;
    log.addLog('error', `《${song.name}》播放失败: ${String(err)}`);
    // 完整堆栈打到 Metro 终端（移动端诊断 TypeError 等异常用）
    console.error(`[player] 《${song.name}》播放失败堆栈:`, (err as Error)?.stack || err);
    if (!fresh && song.sourceType !== 'local') {
      // 解析失败 → 同一首歌换新 URL 重试一次；本地文件失败直接跳歌
      await playSong(song, retryCount, true);
    } else {
      const nextSong = nextSongAfterError(retryCount);
      if (nextSong) {
        log.addLog('warn', `《${song.name}》播放失败，自动跳过`);
        await playSong(nextSong, retryCount + 1, false);
      } else {
        await stopAllPlayers();
        usePlayerStore.getState().pause();
        log.reportError(`《${song.name}》播放失败，且队列中没有其他歌曲`);
      }
    }
  } finally {
    preparingPlayback = false;
  }
}

export async function togglePlay(): Promise<void> {
  const log = useLogsStore.getState();
  const song = usePlayerStore.getState().currentSong;

  if (!player) {
    // 正在解析 URL/创建播放器：忽略点击（防止反复触发 fresh 重试解析）
    if (preparingPlayback) return;
    // 播放器已被清理（如队列耗尽后）→ 用全新 URL 重试当前歌曲
    if (song) await playSong(song, 0, true);
    return;
  }

  if (player.playing) {
    player.pause();
    usePlayerStore.getState().pause();
    if (song) {
      log.addLog('info', `暂停《${song.name}》`);
      void updateNotification(song, false).catch(() => {});
    }
  } else {
    player.play();
    usePlayerStore.getState().resume();
    if (song) {
      log.addLog('info', `继续播放《${song.name}》`);
      void updateNotification(song, true).catch(() => {});
    }
  }
}

export async function seekTo(timeSec: number): Promise<void> {
  if (player) {
    await player.seekTo(timeSec);
  }
}

export async function cleanup(): Promise<void> {
  await stopAllPlayers();
  await clearNotification().catch(() => {});
}
