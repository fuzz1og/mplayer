// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LazyCover（#496）组件契约：
 * 1. `uri` 为空只渲染占位 `View`；有 uri 直接挂 `Image`（**没有闸门排队**）；
 * 2. 失败**重试一次**（间隔 `COVER_RETRY_DELAY_MS`），仍失败才回调 `onError`；
 * 3. 换 uri 重新获得一次重试机会。
 *
 * `react-native` 换成受控替身：Image 的 onError 用点击触发（不依赖 RN 原生事件）。
 * 注意替身**不给外层挂 onLoad**——避免「点 error 冒泡触发 load」把用例搅在一起。
 */

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Image: (props: any) => React.createElement(
      'div',
      { 'data-testid': 'cover-image', 'data-uri': props.source?.uri },
      React.createElement('span', { 'data-testid': 'cover-error', onClick: props.onError }),
    ),
    View: () => React.createElement('div', { 'data-testid': 'cover-box' }),
  };
});

import LazyCover, { COVER_RETRY_DELAY_MS } from '../components/LazyCover';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';

const URI = 'https://p1.music.126.net/cover.jpg';

describe('LazyCover', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('uri 为空只渲染占位，不挂 Image', () => {
    render(<LazyCover />);
    expect(screen.queryByTestId('cover-image')).toBeNull();
    expect(screen.getByTestId('cover-box')).toBeTruthy();
  });

  it('有 uri 直接挂 Image（不再等槽位）', () => {
    render(<LazyCover uri={URI} />);
    expect(screen.getByTestId('cover-image')).toBeTruthy();
    expect(screen.queryByTestId('cover-box')).toBeNull();
  });

  it('失败后重试一次；仍失败才回调 onError，且不再重试', () => {
    const onError = vi.fn();
    render(<LazyCover uri={URI} onError={onError} />);

    fireEvent.click(screen.getByTestId('cover-error'));
    expect(onError).not.toHaveBeenCalled(); // 首挂失败只是安排重试
    act(() => { vi.advanceTimersByTime(COVER_RETRY_DELAY_MS); });
    expect(screen.getByTestId('cover-image')).toBeTruthy(); // 已重新挂载

    fireEvent.click(screen.getByTestId('cover-error'));
    expect(onError).toHaveBeenCalledTimes(1); // 重试也失败 → 上报

    act(() => { vi.advanceTimersByTime(COVER_RETRY_DELAY_MS * 5); });
    expect(onError).toHaveBeenCalledTimes(1); // 只重试一次
  });

  it('换 uri 后重新获得一次重试机会', () => {
    const onError = vi.fn();
    const view = render(<LazyCover uri={URI} onError={onError} />);

    fireEvent.click(screen.getByTestId('cover-error'));
    act(() => { vi.advanceTimersByTime(COVER_RETRY_DELAY_MS); });
    fireEvent.click(screen.getByTestId('cover-error'));
    expect(onError).toHaveBeenCalledTimes(1);

    view.rerender(<LazyCover uri={URI + '?v=2'} onError={onError} />);
    fireEvent.click(screen.getByTestId('cover-error'));
    act(() => { vi.advanceTimersByTime(COVER_RETRY_DELAY_MS); });
    expect(onError).toHaveBeenCalledTimes(1); // 新图的首挂失败仍只是安排重试
    expect(screen.getByTestId('cover-image')).toBeTruthy();
  });

  it('http 封面按 CDN 缩略图取（?param=WxH）', () => {
    render(<LazyCover uri={URI} />);
    expect(screen.getByTestId('cover-image').getAttribute('data-uri')).toBe(
      URI + '?param=' + COVER_SIZE.thumb + 'y' + COVER_SIZE.thumb,
    );
  });

  it('已有 param 的不重复拼；非 http（本地文件 / data:）原样', () => {
    render(<LazyCover uri={URI + '?param=100y100'} />);
    expect(screen.getByTestId('cover-image').getAttribute('data-uri')).toBe(URI + '?param=100y100');

    cleanup();
    render(<LazyCover uri="file:///tmp/a.jpg" />);
    expect(screen.getByTestId('cover-image').getAttribute('data-uri')).toBe('file:///tmp/a.jpg');
  });

  it('coverThumbUrl 只处理已知机制的源', () => {
    expect(coverThumbUrl('https://p1.music.126.net/a==/b.jpg', 100)).toBe('https://p1.music.126.net/a==/b.jpg?param=100y100');
    expect(coverThumbUrl('https://p1.music.126.net/a==/b.jpg?q=1', 100)).toBe('https://p1.music.126.net/a==/b.jpg?q=1&param=100y100');
    expect(coverThumbUrl('file:///a.jpg', 100)).toBe('file:///a.jpg');
    expect(coverThumbUrl('https://p1.music.126.net/a==/b.jpg?param=9y9', 100)).toBe('https://p1.music.126.net/a==/b.jpg?param=9y9');
  });

  it('卸载后不再触发重试', () => {
    const onError = vi.fn();
    const view = render(<LazyCover uri={URI} onError={onError} />);
    fireEvent.click(screen.getByTestId('cover-error'));
    view.unmount();
    act(() => { vi.advanceTimersByTime(COVER_RETRY_DELAY_MS * 5); });
    expect(onError).not.toHaveBeenCalled();
  });
});
