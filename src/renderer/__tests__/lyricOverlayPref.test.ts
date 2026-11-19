import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLOATING_LYRICS_ENABLED_KEY,
  readFloatingLyricsEnabled,
  setFloatingLyricsEnabled,
  subscribeFloatingLyricsEnabled,
  toggleFloatingLyrics,
} from '@/renderer/services/lyricOverlay';

describe('悬浮歌词开关持久化（#769）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认关；只认字符串 true', () => {
    expect(readFloatingLyricsEnabled()).toBe(false);
    localStorage.setItem(FLOATING_LYRICS_ENABLED_KEY, '1');
    expect(readFloatingLyricsEnabled()).toBe(false);
  });

  it('写入后按 true 读回，关闭写 false', () => {
    setFloatingLyricsEnabled(true);
    expect(localStorage.getItem(FLOATING_LYRICS_ENABLED_KEY)).toBe('true');
    expect(readFloatingLyricsEnabled()).toBe(true);
    setFloatingLyricsEnabled(false);
    expect(readFloatingLyricsEnabled()).toBe(false);
  });

  it('切换会通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFloatingLyricsEnabled(listener);
    toggleFloatingLyrics();
    expect(listener).toHaveBeenCalledWith(true);
    toggleFloatingLyrics();
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
  });
});
