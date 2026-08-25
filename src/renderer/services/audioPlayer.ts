import { Howl } from 'howler';
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
  /** 挂起中的 load() Promise 的 reject（cancelLoad/被新 load 取代时主动 settle，避免永不落定）。 */
  private pendingReject: ((reason: Error) => void) | null = null;

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
      // settle 保护：一次 load 只落定一次（onloaderror 后 onplayerror 等重复回调不再生效）
      let settled = false;
      const settleResolve = () => { if (!settled) { settled = true; this.pendingReject = null; resolve(); } };
      const settleReject = (err: Error) => { if (!settled) { settled = true; this.pendingReject = null; reject(err); } };
      this.pendingReject = settleReject;

      if (!song.url) {
        this.setState('error');
        settleReject(new Error('歌曲URL为空'));
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
          // 已被新 load/cancelLoad 取代：旧 Howl 已 unload，事件属迟到的幽灵回调，
          // 直接落定（Promise 由 cancelLoad 的 reject 或新 load 接管，这里不重复处理）
          if (loadId !== this.loadIdCounter) return;
          const duration = this.howl?.duration() || 0;
          this.callbacks.onDurationChange?.(duration);
          this.setState('paused');
          settleResolve();
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
          settleReject(err);
        },
        onplayerror: (_id, error) => {
          if (loadId !== this.loadIdCounter) return;
          this.setState('error');
          const err = new Error(`播放音频失败: ${error}`);
          this.callbacks.onLoadError?.(err);
          settleReject(err);
        }
      });
    });
  }

  cancelLoad(): void {
    this.loadIdCounter++;
    // 审查修复：主动 settle 挂起的 load() Promise，避免被取消的加载永远 pending
    // （旧 Howl 已 unload 后其回调不会再派发，不主动 reject 则 await 方永远卡死）。
    // 调用方（playerStore.play）有 generation 守卫，被取代的 reject 不会污染新状态。
    this.pendingReject?.(new Error('加载已取消'));
    this.pendingReject = null;
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
    // 审查修复：不再调用 Howler.volume（全局）——单播放器场景下 howl.volume 已生效，
    // 全局设置冗余且会影响未来可能新增的音频实例
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
    this.pendingReject?.(new Error('播放器已销毁'));
    this.pendingReject = null;
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
