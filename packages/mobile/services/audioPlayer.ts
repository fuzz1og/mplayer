import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioStatus } from 'expo-audio';
import type { EventSubscription } from 'expo-modules-core';
import { musicApi, resolvePlayableUrl } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { updateNotification, clearNotification } from './notificationService';

type Player = ReturnType<typeof createAudioPlayer>;

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

function disposePlayer(): void {
  playerStatusSubscription?.remove();
  playerStatusSubscription = null;
  player?.remove();
  player = null;
}

function nextSongAfterError(retryCount: number): Song | null {
  const s = usePlayerStore.getState();
  if (retryCount + 1 >= s.queue.length) return null;
  return s.next();
}

export async function playSong(song: Song, retryCount = 0): Promise<void> {
  const playId = ++currentPlayId;

  // Immediately stop the current player instead of waiting for the old run to finish.
  disposePlayer();

  const startPlayback = async (): Promise<void> => {
    const audioUrl = await resolvePlayableUrl(song, musicApi);
    if (playId !== currentPlayId) throw 'cancelled';

    const nextPlayer = createAudioPlayer({ uri: audioUrl }, { updateInterval: 250 });
    player = nextPlayer;

    playerStatusSubscription = nextPlayer.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (playId !== currentPlayId) return;

      if (!status.isLoaded) {
        if (status.error) {
          const nextSong = nextSongAfterError(retryCount);
          if (nextSong) setTimeout(() => {
            if (playId === currentPlayId) void playSong(nextSong, retryCount + 1);
          }, 0);
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

      if (status.didJustFinish) {
        const nextSong = s.next();
        if (nextSong) setTimeout(() => {
          if (playId === currentPlayId) void playSong(nextSong);
        }, 0);
      }
    });

    nextPlayer.setActiveForLockScreen(true, {
      title: song.name,
      artist: song.artist,
      albumTitle: song.album,
      artworkUrl: song.cover || undefined,
    });
    nextPlayer.play();

    useHistoryStore.getState().addHistory(song);
    void updateNotification(song, true).catch(() => {});
  };

  try {
    await startPlayback();
  } catch (err) {
    if (err === 'cancelled') return;
    console.error(`[playSong] error for song ${song.id} (${song.name}):`, err);
    const nextSong = nextSongAfterError(retryCount);
    if (nextSong) await playSong(nextSong, retryCount + 1);
  }
}

export async function togglePlay(): Promise<void> {
  if (!player) return;
  const song = usePlayerStore.getState().currentSong;

  if (player.playing) {
    player.pause();
    usePlayerStore.getState().pause();
    if (song) void updateNotification(song, false).catch(() => {});
  } else {
    player.play();
    usePlayerStore.getState().resume();
    if (song) void updateNotification(song, true).catch(() => {});
  }
}

export async function seekTo(timeSec: number): Promise<void> {
  if (player) {
    await player.seekTo(timeSec);
  }
}

export async function cleanup(): Promise<void> {
  disposePlayer();
  await clearNotification().catch(() => {});
}
