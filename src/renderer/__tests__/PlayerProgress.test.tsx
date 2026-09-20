import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerProgress from '../components/PlayerProgress';
import { playbackClock } from '../services/playbackClock';

// jsdom 不带 PointerEvent：用 MouseEvent 子类补指针语义，否则 fireEvent.pointerDown/Move
// 的 clientX/pointerId 传不进 handler（生产代码走真实 PointerEvent，不受影响）。
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
    PointerEventPolyfill as unknown as typeof PointerEvent;
}

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

  it('点击轨道后进度条保有焦点（preventDefault 不得吞掉键盘入口）', () => {
    playbackClock.setPosition(30);
    const onSeek = vi.fn();
    render(<PlayerProgress hasCurrentSong onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: '播放进度' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(trackRect);

    fireEvent.pointerDown(slider, { clientX: 50, button: 0, pointerId: 1 });
    expect(document.activeElement).toBe(slider); // 去掉显式 focus 即转红

    fireEvent.pointerUp(slider, { clientX: 50, pointerId: 1 });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(35);
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

  it('按住拖动跟手：移动期间本地渲染不提交，松手只 seek 一次', () => {
    playbackClock.setPosition(30);
    const onSeek = vi.fn();
    render(<PlayerProgress hasCurrentSong onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: '播放进度' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(trackRect);

    fireEvent.pointerDown(slider, { clientX: 50, button: 0, pointerId: 1 }); // 25%
    fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 });           // 75%

    // 移动期间不提交 seek，但 UI 立即跟手（不等 250ms 时钟采样）
    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.getByText('01:30')).toBeInTheDocument();

    fireEvent.pointerUp(slider, { clientX: 150, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(90); // 75% × 120s
  });

  it('拖拽松手后浏览器补发的 click 不再重复 seek', () => {
    playbackClock.setPosition(0);
    const onSeek = vi.fn();
    render(<PlayerProgress hasCurrentSong onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: '播放进度' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(trackRect);

    fireEvent.pointerDown(slider, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 100, pointerId: 1 });
    fireEvent.click(slider, { clientX: 100 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(60); // 50% × 120s
  });

  it('pointercancel 取消拖拽：不提交 seek', () => {
    playbackClock.setPosition(30);
    const onSeek = vi.fn();
    render(<PlayerProgress hasCurrentSong onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: '播放进度' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(trackRect);

    fireEvent.pointerDown(slider, { clientX: 50, button: 0, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 });
    fireEvent.pointerCancel(slider, { pointerId: 1 });

    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.getByText('00:30')).toBeInTheDocument(); // 回到时钟位置
  });
});
