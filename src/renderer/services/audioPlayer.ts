import { Howl, Howler } from 'howler';
import type { Song } from '@mplayer/core';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface AudioPlayerCallbacks {
  onStateChange?: (state: PlayerState) => void;
  onPositionChange?: (position: number) => void;
  onDurationChange?: (duration: number) => void;
  onLoadError?: (error: Error) => void;
  onEnd?: () => void;
}

export class AudioPlayer {
  private howl: Howl | null = null;
  private currentSong: Song | null = null;
  private state: PlayerState = 'idle';
  private callbacks: AudioPlayerCallbacks = {};
  private positionInterval: NodeJS.Timeout | null = null;
  private volume: number = 80;
  private loadIdCounter: number = 0;

  constructor(callbacks: AudioPlayerCallbacks = {}) {
    this.callbacks = callbacks;
    this.startPositionTracking();
  }

  private startPositionTracking(): void {
    this.positionInterval = setInterval(() => {
      if (this.howl && this.state === 'playing') {
        const position = this.howl.seek() as number;
        this.callbacks.onPositionChange?.(position);
      }
    }, 250);
  }

  private stopPositionTracking(): void {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }

  private setState(newState: PlayerState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.callbacks.onStateChange?.(newState);
    }
  }

async load(song: Song): Promise<void> {
    if (this.howl) {
      this.howl.unload();
      this.howl = null;
    }

    this.currentSong = song;
    this.setState('loading');

    const loadId = ++this.loadIdCounter;

    return new Promise((resolve, reject) => {
      if (!song.url) {
        this.setState('error');
        reject(new Error('歌曲URL为空'));
        return;
      }

      this.howl = new Howl({
        src: [song.url],
        html5: true,
        // 绕过 Howler 的 URL 扩展名 codec 检测
        // API URL 以 .php 结尾，Howler 提取 "php" 作为扩展名导致 "No codec support" 错误
        format: ['mp3', 'flac', 'm4a', 'ogg', 'wav', 'aac'],
        volume: this.volume / 100,
        onload: () => {
          if (loadId !== this.loadIdCounter) return;
          const duration = this.howl?.duration() || 0;
          this.callbacks.onDurationChange?.(duration);
          this.setState('paused');
          resolve();
        },
        onplay: () => {
          if (loadId !== this.loadIdCounter) return;
          this.setState('playing');
        },
        onpause: () => {
          if (loadId !== this.loadIdCounter) return;
          this.setState('paused');
        },
        onstop: () => {
          if (loadId !== this.loadIdCounter) return;
          this.setState('paused');
        },
        onend: () => {
          if (loadId !== this.loadIdCounter) return;
          this.setState('paused');
          this.callbacks.onEnd?.();
        },
        onloaderror: (_id, error) => {
          if (loadId !== this.loadIdCounter) return;
          this.setState('error');
          const err = new Error(`加载音频失败: ${error}`);
          this.callbacks.onLoadError?.(err);
          reject(err);
        },
        onplayerror: (_id, error) => {
          if (loadId !== this.loadIdCounter) return;
          this.setState('error');
          const err = new Error(`播放音频失败: ${error}`);
          this.callbacks.onLoadError?.(err);
          reject(err);
        }
      });
    });
  }

  cancelLoad(): void {
    this.loadIdCounter++;
    if (this.howl) {
      this.howl.unload();
      this.howl = null;
    }
  }

  play(): void {
    if (this.howl && this.state !== 'playing') {
      this.howl.play();
    }
  }

  pause(): void {
    if (this.howl) {
      this.howl.pause();
    }
  }

  stop(): void {
    if (this.howl) {
      this.howl.stop();
    }
    this.setState('idle');
  }

  seek(position: number): void {
    if (this.howl) {
      this.howl.seek(position);
      this.callbacks.onPositionChange?.(position);
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    if (this.howl) {
      this.howl.volume(this.volume / 100);
    }
    Howler.volume(this.volume / 100);
  }

  getVolume(): number {
    return this.volume;
  }

  getState(): PlayerState {
    return this.state;
  }

  getCurrentSong(): Song | null {
    return this.currentSong;
  }

  getPosition(): number {
    if (this.howl) {
      return this.howl.seek() as number;
    }
    return 0;
  }

  getDuration(): number {
    if (this.howl) {
      return this.howl.duration();
    }
    return 0;
  }

  isPlaying(): boolean {
    return this.state === 'playing';
  }

  isPaused(): boolean {
    return this.state === 'paused';
  }

  isLoading(): boolean {
    return this.state === 'loading';
  }

  destroy(): void {
    this.stopPositionTracking();
    if (this.howl) {
      this.howl.unload();
      this.howl = null;
    }
    this.currentSong = null;
    this.setState('idle');
  }
}

let globalPlayer: AudioPlayer | null = null;

export function getGlobalPlayer(callbacks?: AudioPlayerCallbacks): AudioPlayer {
  if (!globalPlayer) {
    globalPlayer = new AudioPlayer(callbacks);
  }
  return globalPlayer;
}

export function destroyGlobalPlayer(): void {
  if (globalPlayer) {
    globalPlayer.destroy();
    globalPlayer = null;
  }
}
