import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlayerControls from '../components/PlayerControls';

/**
 * 桌面等待态反馈（#387）：冷启 P50 ≈1s 期间播放键位置显示 spinner
 * （对齐移动端已有的 preparing），消除「界面完全静止」。
 */

const base = {
  isPlaying: false,
  hasCurrentSong: true,
  playMode: '列表循环' as const,
  onPlayPause: () => {},
  onPrev: () => {},
  onNext: () => {},
  onModeChange: () => {},
};

describe('PlayerControls 等待态（#387）', () => {
  it('加载中 → 播放键位置显示 spinner（aria-label=加载中）', () => {
    render(<PlayerControls {...base} loading />);

    expect(screen.getByRole('button', { name: '加载中' })).toBeInTheDocument();
    expect(screen.getByTestId('player-loading')).toBeInTheDocument();
  });

  it('非加载态 → 仍显示播放/暂停，不出现 spinner', () => {
    const { rerender } = render(<PlayerControls {...base} />);
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
    expect(screen.queryByTestId('player-loading')).toBeNull();

    rerender(<PlayerControls {...base} isPlaying />);
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(screen.queryByTestId('player-loading')).toBeNull();
  });
});
