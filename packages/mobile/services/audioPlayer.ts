import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioStatus } from 'expo-audio';
import type { EventSubscription } from 'expo-modules-core';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheManager, musicApi, resolvePlayableUrl } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { useLogsStore } from '../stores/logsStore';
import { updateNotification, clearNotification } from './notificationService';

type Player = ReturnType<typeof createAudioPlayer>;

// Expo Go 未启用 expo-audio 的 background playback 配置插件，
// 锁屏控制/后台播放不可用，跳过 setActiveForLockScreen 避免报错刷屏
const isExpoGo = Constants.expoGoConfig !== null;

// 播放 URL 持久化缓存(songId→url):二次播放(含重启后)直接命中,跳过重新解析;
// URL 过期由加载失败后的 fresh 重试兜底,不会卡死
const URL_CACHE_PREFIX = 'songUrl:';

async function getCachedSongUrl(songId: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(URL_CACHE_PREFIX + songId);
    return v?.startsWith('http') ? v : null;
  } catch {
    return null;
  }
}

async function cacheSongUrl(songId: string, url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(URL_CACHE_PREFIX + songId, url);
  } catch {
    // 忽略缓存写失败
  }
}

// 追踪所有创建过的播放器：expo-audio 的原生释放是异步的，
// remove() 后旧播放器可能仍在出声，切换前必须逐个显式暂停。
const livePlayers = new Set<Player>();
let player: Player | null = null;
let playerStatusSubscription: EventSubscription | null = null;
let currentPlayId = 0;

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
 */
function stopAllPlayers(): void {
  for (const p of livePlayers) {
    try { p.pause(); } catch {}
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
 * 播放失败后为同一首歌获取全新可播 URL。
 * 收藏/历史里的 url 可能已过期（音乐源直链一般数小时失效），
 * 先清掉 audioUrl 内存缓存，再重新解析，避免拿到过期的缓存直链。
 */
async function refreshPlayableUrl(song: Song): Promise<string> {
  cacheManager.clearByPrefix('audioUrl');

  // 汽水音乐 → 重新拿直链
  if (song.sourceType === 'soda' && song.id) {
    const u = await musicApi.getSodaAudioUrl(song.id);
    if (u?.startsWith('http')) return u;
  }

  // 普通源 → 跟随重定向取最新直链（重定向结果未变说明源 URL 已失效）
  if (song.url?.startsWith('http')) {
    const u = await musicApi.getAudioUrl(song.url);
    if (u?.startsWith('http') && u !== song.url) return u;
  }

  // 最后手段：重新搜索拿新 URL
  if (song.name) {
    const results = await musicApi.searchSongs(`${song.name} ${song.artist}`, 1, song.sourceType);
    const fresh = results[0];
    if (fresh?.url?.startsWith('http')) return fresh.url;
  }

  throw new Error('fresh URL resolve failed');
}

/**
 * 播放歌曲。
 * @param retryCount 级联跳歌计数（防止全部失效时无限循环）
 * @param fresh 为 true 时绕过原有 url，重新解析全新可播 URL
 */
export async function playSong(song: Song, retryCount = 0, fresh = false): Promise<void> {
  const playId = ++currentPlayId;
  const log = useLogsStore.getState();

  const startPlayback = async (): Promise<void> => {
    let audioUrl: string;
    if (fresh) {
      audioUrl = await refreshPlayableUrl(song);
    } else if (song.url?.startsWith('http')) {
      audioUrl = song.url;
    } else {
      // 优先持久化缓存,未命中再解析(单首搜索兜底)
      audioUrl = (await getCachedSongUrl(song.id)) || (await resolvePlayableUrl(song, musicApi));
    }
    if (playId !== currentPlayId) throw 'cancelled';
    if (!audioUrl?.startsWith('http')) throw new Error('no playable URL');

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
          if (!fresh) {
            // 同一首歌换全新 URL 重试一次（收藏/历史里的 url 可能已过期）
            log.addLog('warn', `《${song.name}》将使用新 URL 重试`);
            setTimeout(() => { if (playId === currentPlayId) void playSong(song, retryCount, true); }, 0);
          } else {
            const nextSong = nextSongAfterError(retryCount);
            if (nextSong) {
              log.addLog('warn', `《${song.name}》播放失败，自动跳过`);
              setTimeout(() => { if (playId === currentPlayId) void playSong(nextSong, retryCount + 1, false); }, 0);
            } else {
              // 队列已耗尽：停止假播放并提示
              stopAllPlayers();
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

    // 播放 URL 落缓存:下次(含重启后)直接命中,秒起
    if (audioUrl?.startsWith('http')) void cacheSongUrl(song.id, audioUrl);

    log.addLog('info', `开始播放《${song.name}》- ${song.artist}${fresh ? '（新URL重试）' : ''}`);
    useHistoryStore.getState().addHistory(song);
    void updateNotification(song, true).catch(() => {});
  };

  try {
    stopAllPlayers();
    await startPlayback();
  } catch (err) {
    if (err === 'cancelled') return;
    log.addLog('error', `《${song.name}》播放失败: ${String(err)}`);
    if (!fresh) {
      // 解析失败 → 同一首歌换新 URL 重试一次
      await playSong(song, retryCount, true);
    } else {
      const nextSong = nextSongAfterError(retryCount);
      if (nextSong) {
        log.addLog('warn', `《${song.name}》播放失败，自动跳过`);
        await playSong(nextSong, retryCount + 1, false);
      } else {
        stopAllPlayers();
        usePlayerStore.getState().pause();
        log.reportError(`《${song.name}》播放失败，且队列中没有其他歌曲`);
      }
    }
  }
}

export async function togglePlay(): Promise<void> {
  const log = useLogsStore.getState();
  const song = usePlayerStore.getState().currentSong;

  if (!player) {
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
  stopAllPlayers();
  await clearNotification().catch(() => {});
}
