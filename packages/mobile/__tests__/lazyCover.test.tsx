// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LazyCover（#496）组件契约：
 * 1. 未拿到槽位不挂 Image（= 不发请求），到手后才挂；
 * 2. onLoad / onError / 卸载三处都归还槽位（闸门额度不漏）；
 * 3. uri 为空不占槽位。
 *
 * 这里把 `react-native` 与 `services/coverLoadGate` 都换成受控替身：
 * 闸门由用例手动放行，Image 的 onLoad / onError 用点击触发（不依赖 RN 原生事件）。
 */

const gate = vi.hoisted(() => {
  const releases: ReturnType<typeof vi.fn>[] = [];
  const resolvers: (() => void)[] = [];
  const acquire = vi.fn(() => {
    let resolve!: () => void;
    const ready = new Promise<void>((r) => { resolve = r; });
    const release = vi.fn();
    resolvers.push(resolve);
    releases.push(release);
    return { ready, release };
  });
  return {
    acquire,
    releases,
    resolvers,
    reset() {
      releases.length = 0;
      resolvers.length = 0;
      acquire.mockClear();
    },
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Image: (props: any) => React.createElement(
      'div',
      { 'data-testid': 'cover-image', onClick: props.onLoad },
      React.createElement('span', { 'data-testid': 'cover-error', onClick: props.onError }),
    ),
    View: () => React.createElement('div', { 'data-testid': 'cover-box' }),
  };
});

vi.mock('../services/coverLoadGate', () => ({
  coverLoadGate: { acquire: gate.acquire },
}));

import LazyCover from '../components/LazyCover';

const URI = 'https://p1.music.126.net/cover.jpg';

describe('LazyCover', () => {
  beforeEach(() => { gate.reset(); });
  afterEach(() => { cleanup(); });

  it('未拿到槽位不挂 Image，到手后才挂', async () => {
    render(<LazyCover uri={URI} />);
    expect(gate.acquire).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('cover-image')).toBeNull();
    expect(screen.getByTestId('cover-box')).toBeTruthy();

    await act(async () => { gate.resolvers[0](); });
    expect(screen.getByTestId('cover-image')).toBeTruthy();
  });

  it('图片 load 后归还槽位', async () => {
    render(<LazyCover uri={URI} />);
    await act(async () => { gate.resolvers[0](); });
    fireEvent.click(screen.getByTestId('cover-image'));
    expect(gate.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('图片 error 后归还槽位并回调 onError', async () => {
    const onError = vi.fn();
    render(<LazyCover uri={URI} onError={onError} />);
    await act(async () => { gate.resolvers[0](); });
    fireEvent.click(screen.getByTestId('cover-error'));
    expect(gate.releases[0]).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('卸载归还槽位', () => {
    const view = render(<LazyCover uri={URI} />);
    view.unmount();
    expect(gate.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('uri 为空不占槽位', () => {
    render(<LazyCover />);
    expect(gate.acquire).not.toHaveBeenCalled();
    expect(screen.getByTestId('cover-box')).toBeTruthy();
  });
});
