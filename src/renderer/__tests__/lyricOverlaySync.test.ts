import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { playbackClock } from '@/renderer/services/playbackClock';
import {
  setFloatingLyricsEnabled,
  startLyricOverlaySync,
} from '@/renderer/services/lyricOverlay';
import type { LyricOverlaySnapshot } from '@/shared/lyricOverlay';
import type { Song } from '@mplayer/core';

const LRC = '[00:05.00]第一句\n[00:10.00]第二句';

function song(): Song {
  return {
    id: 'song-1',
    name: '测试歌曲',
    artist: '测试歌手',
    album: '',
    sourceType: 'netease',
    url: '',
    cover: '',
    lrc: '',
    duration: 30,
  } as Song;
}

function sentSnapshots(send: ReturnType<typeof vi.fn>): LyricOverlaySnapshot[] {
  return send.mock.calls
    .filter(([channel]) => channel === 'lyricOverlay:state')
    .map(([, snapshot]) => snapshot as LyricOverlaySnapshot);
}

describe('主窗渲染层 → 覆盖层快照同步（#766）', () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    usePlayerStore.setState({
      currentSong: null,
      lyrics: '',
      lyricsLoading: false,
      isPlaying: false,
      error: null,
    });
    playbackClock.reset();
    playbackClock.setPlaying(false);
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    playbackClock.setPlaying(false);
    vi.useRealTimers();
  });

  it('启动即推全量快照（默认关 / 不可见）', () => {
    const send = vi.fn();
    dispose = startLyricOverlaySync({ send, now: () => 0 });
    const [initial] = sentSnapshots(send);
    expect(initial).toMatchObject({ enabled: false, visible: false, playing: false, songId: null });
  });

  it('开关开 + 歌词到达 + 播放中 → 推送可见快照', () => {
    const send = vi.fn();
    dispose = startLyricOverlaySync({ send, now: () => 0 });
    setFloatingLyricsEnabled(true);
    usePlayerStore.setState({ currentSong: song(), lyrics: LRC, isPlaying: true });
    playbackClock.setDuration(30);
    playbackClock.setPosition(6);
    playbackClock.setPlaying(true);

    const snapshots = sentSnapshots(send);
    expect(snapshots.some((s) => s.enabled && s.visible && s.playing && s.songId === 'song-1')).toBe(true);
    const visible = snapshots.filter((s) => s.visible).at(-1)!;
    expect(visible.lyricsText).toBe(LRC);
    expect(visible.durationSec).toBe(30);
  });

  it('暂停中 seek 重锚（小幅位置变化也要推）', () => {
    const send = vi.fn();
    dispose = startLyricOverlaySync({ send, now: () => 0 });
    setFloatingLyricsEnabled(true);
    usePlayerStore.setState({ currentSong: song(), lyrics: LRC, isPlaying: false });
    playbackClock.setDuration(30);
    playbackClock.setPosition(6);
    send.mockClear();

    playbackClock.setPosition(7.2);
    expect(sentSnapshots(send).at(-1)).toMatchObject({ positionSec: 7.2, playing: false });
  });

  it('播放中正常走表不推送，seek 跳变才重锚', () => {
    const send = vi.fn();
    let nowMs = 0;
    dispose = startLyricOverlaySync({ send, now: () => nowMs });
    setFloatingLyricsEnabled(true);
    usePlayerStore.setState({ currentSong: song(), lyrics: LRC, isPlaying: true });
    playbackClock.setDuration(30);
    playbackClock.setPosition(6);
    playbackClock.setPlaying(true);
    send.mockClear();

    // 正常 250ms 走表：位置连续，不推
    nowMs = 250;
    playbackClock.setPosition(6.25);
    expect(sentSnapshots(send)).toHaveLength(0);

    // seek 到 15s：跳变超阈值 → 重锚
    nowMs = 500;
    playbackClock.setPosition(15);
    expect(sentSnapshots(send).at(-1)).toMatchObject({ positionSec: 15, playing: true });
  });

  it('播放且可见时约 10s 心跳纠偏', () => {
    const send = vi.fn();
    let nowMs = 0;
    dispose = startLyricOverlaySync({ send, now: () => nowMs });
    setFloatingLyricsEnabled(true);
    usePlayerStore.setState({ currentSong: song(), lyrics: LRC, isPlaying: true });
    playbackClock.setDuration(30);
    playbackClock.setPosition(6);
    playbackClock.setPlaying(true);
    send.mockClear();

    nowMs = 5_000;
    playbackClock.setPosition(6);
    expect(sentSnapshots(send)).toHaveLength(0);

    nowMs = 10_000;
    vi.advanceTimersByTime(10_000);
    expect(sentSnapshots(send).length).toBeGreaterThanOrEqual(1);
  });
});
