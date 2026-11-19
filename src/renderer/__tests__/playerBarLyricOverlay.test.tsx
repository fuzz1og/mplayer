import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlayerBar from '@/renderer/components/PlayerBar';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { FLOATING_LYRICS_ENABLED_KEY } from '@/renderer/services/lyricOverlay';

describe('播放栏「词」按钮（#765 / #769）', () => {
  beforeEach(() => {
    localStorage.clear();
    usePlayerStore.setState({ currentSong: null, isPlaying: false });
  });

  it('默认关：文案「词」、aria-pressed=false，无当前曲也可点', () => {
    render(<PlayerBar />);
    const button = screen.getByRole('button', { name: '悬浮歌词' });
    expect(button).toHaveTextContent('词');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toBeDisabled();
  });

  it('点击切换并持久化到 floatingLyricsEnabled', () => {
    render(<PlayerBar />);
    const button = screen.getByRole('button', { name: '悬浮歌词' });

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(FLOATING_LYRICS_ENABLED_KEY)).toBe('true');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(FLOATING_LYRICS_ENABLED_KEY)).toBe('false');
  });
});
