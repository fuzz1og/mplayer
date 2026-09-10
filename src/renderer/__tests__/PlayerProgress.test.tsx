import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerProgress from '../components/PlayerProgress';
import { playbackClock } from '../services/playbackClock';

/** 时钟采样源：测试里手动改这个变量模拟播放推进 */
let sampledPosition = 0;

beforeEach(() => {
  playbackClock.destroy();
  sampledPosition = 0;
  playbackClock.connect(() => sampledPosition);
  playbackClock.setDuration(120);
});

const trackRect = {
  left: 0, right: 200, top: 0, bottom: 16, width: 200, height: 16, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

describe('PlayerProgress（进度条自订阅 playbackClock）', () => {
  it('渲染时钟快照的当前时间与总时长', () => {
    playbackClock.setPosition(65);
    render(<PlayerProgress hasCurrentSong onSeek={vi.fn()} />);

    expect(screen.getByText('01:05')).toBeInTheDocument();
    expect(screen.getByText('02:00')).toBeInTheDocument();
  });

  it('时钟位置变化立即反映到进度条（无需父组件传值）', () => {
    render(<PlayerProgress hasCurrentSong onSeek={vi.fn()} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();

    act(() => { playbackClock.setPosition(30); });

    expect(screen.getByText('00:30')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '播放进度' })).toHaveAttribute('aria-valuenow', '30');
  });

  it('同一位置的采样不触发重渲染（tick 不落到进度块上）', () => {
    vi.useFakeTimers();
    try {
      const onRender = vi.fn();
      render(
        <Profiler id="progress" onRender={onRender}>
          <PlayerProgress hasCurrentSong onSeek={vi.fn()} />
        </Profiler>
      );
      onRender.mockClear();

      act(() => {
        playbackClock.setPosition(0);
        playbackClock.setPlaying(true);
      });
      act(() => { vi.advanceTimersByTime(1000); });

      expect(onRender).not.toHaveBeenCalled();
      playbackClock.setPlaying(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('点击轨道按「百分比 × 时长」seek（沿用旧语义）', () => {
    playbackClock.setPosition(30);
    const onSeek = vi.fn();
    render(<PlayerProgress hasCurrentSong onSeek={onSeek} />);

    const slider = screen.getByRole('slider', { name: '播放进度' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(trackRect);
    fireEvent.click(slider, { clientX: 50 });

    expect(onSeek).toHaveBeenCalledWith(30); // 25% × 120s
  });

  it('键盘 ±5s / Home / End 语义不变', () => {
    playbackClock.setPosition(30);
    const onSeek = vi.fn();
    render(<PlayerProgress hasCurrentSong onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: '播放进度' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'End' });

    expect(onSeek.mock.calls.map((call) => call[0])).toEqual([35, 25, 0, 119]);
  });

  it('无当前歌曲时不触发 seek', () => {
    const onSeek = vi.fn();
    render(<PlayerProgress hasCurrentSong={false} onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: '播放进度' });

    expect(slider).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(slider, { clientX: 50 });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(onSeek).not.toHaveBeenCalled();
  });
});
