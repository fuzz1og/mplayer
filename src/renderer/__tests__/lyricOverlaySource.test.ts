import { describe, expect, it } from 'vitest';
import {
  buildLyricOverlaySnapshot,
  type LyricOverlaySourceState,
} from '@/renderer/services/lyricOverlay';

const LRC = [
  '[00:05.00]第一句',
  '[00:10.00]第二句',
  '[00:15.00]第三句',
].join('\n');

function source(overrides: Partial<LyricOverlaySourceState> = {}): LyricOverlaySourceState {
  return {
    enabled: true,
    playing: true,
    songId: 'song-1',
    lyricsText: LRC,
    positionSec: 6,
    durationSec: 30,
    lyricsSize: 'standard',
    hasPlaybackError: false,
    ...overrides,
  };
}

describe('悬浮歌词快照（可见性语义 #764）', () => {
  it('开关关闭时即使有词也不可见', () => {
    expect(buildLyricOverlaySnapshot(source({ enabled: false })).visible).toBe(false);
  });

  it('无当前曲 / 无词 / 纯音乐 / 取词失败（解析 0 行）都隐藏', () => {
    expect(buildLyricOverlaySnapshot(source({ songId: null })).visible).toBe(false);
    expect(buildLyricOverlaySnapshot(source({ lyricsText: '' })).visible).toBe(false);
    expect(buildLyricOverlaySnapshot(source({ lyricsText: '纯音乐，请欣赏' })).visible).toBe(false);
  });

  it('播放中有词可见，前奏（当前行 idx<0）同样可见', () => {
    expect(buildLyricOverlaySnapshot(source({ positionSec: 1 })).visible).toBe(true);
  });

  it('暂停时只有已到当前行才可见；暂停在前奏隐藏', () => {
    expect(buildLyricOverlaySnapshot(source({ playing: false, positionSec: 6 })).visible).toBe(true);
    expect(buildLyricOverlaySnapshot(source({ playing: false, positionSec: 1 })).visible).toBe(false);
  });

  it('播放错误 / 队尾落 stop（无当前曲）隐藏', () => {
    expect(buildLyricOverlaySnapshot(source({ hasPlaybackError: true })).visible).toBe(false);
    expect(buildLyricOverlaySnapshot(source({ songId: null, positionSec: 16 })).visible).toBe(false);
  });

  it('快照原样携带锚点与设置字段，不推送当前行文本', () => {
    const snapshot = buildLyricOverlaySnapshot(source({ lyricsSize: 'large' }));
    expect(snapshot).toEqual({
      enabled: true,
      visible: true,
      playing: true,
      songId: 'song-1',
      lyricsText: LRC,
      positionSec: 6,
      durationSec: 30,
      lyricsSize: 'large',
    });
    expect(snapshot).not.toHaveProperty('currentLine');
  });
});
