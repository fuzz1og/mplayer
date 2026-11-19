import { describe, expect, it, vi } from 'vitest';
import { mountLyricOverlay } from '@/renderer/overlay/lyricOverlayApp';
import type { LyricOverlayBridge, LyricOverlaySnapshot } from '@/shared/lyricOverlay';

const LRC = '[00:05.00]第一句\n[00:10.00]第二句\n[00:15.00]第三句';

function snapshot(overrides: Partial<LyricOverlaySnapshot> = {}): LyricOverlaySnapshot {
  return {
    enabled: true,
    visible: true,
    playing: true,
    songId: 'song-1',
    lyricsText: LRC,
    positionSec: 6,
    durationSec: 30,
    lyricsSize: 'standard',
    ...overrides,
  };
}

function createBridge(initial: LyricOverlaySnapshot | null) {
  let listener: ((snapshot: LyricOverlaySnapshot) => void) | null = null;
  const bridge: LyricOverlayBridge = {
    getState: vi.fn(async () => initial),
    onState: vi.fn((next) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
  };
  return { bridge, push: (next: LyricOverlaySnapshot) => listener?.(next) };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('覆盖层页面（零取词 / 本地时钟 / 两行）', () => {
  it('拉取初始快照并渲染当前行 + 下一句，按字号档位切 data-size', async () => {
    const root = document.createElement('div');
    const { bridge } = createBridge(snapshot({ lyricsSize: 'large' }));
    const dispose = mountLyricOverlay(root, bridge, { now: () => 0, setTimeoutFn: () => 0, clearTimeoutFn: () => {} });
    await flush();

    expect(root.dataset.size).toBe('large');
    expect(root.querySelector('.lyric-overlay__current')?.textContent).toBe('第一句');
    expect(root.querySelector('.lyric-overlay__next')?.textContent).toBe('第二句');
    dispose();
  });

  it('推送快照重锚；播放中到行边界由本地时钟自行换行', async () => {
    const root = document.createElement('div');
    let nowMs = 0;
    const timers: { callback: () => void; delay: number }[] = [];
    const { bridge, push } = createBridge(snapshot());
    const dispose = mountLyricOverlay(root, bridge, {
      now: () => nowMs,
      setTimeoutFn: (callback, delay) => {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearTimeoutFn: () => {},
    });
    await flush();
    expect(root.querySelector('.lyric-overlay__current')?.textContent).toBe('第一句');

    push(snapshot({ positionSec: 6 }));
    expect(timers.at(-1)?.delay).toBe(4010);

    nowMs = 4010;
    timers.at(-1)!.callback();
    expect(root.querySelector('.lyric-overlay__current')?.textContent).toBe('第二句');
    expect(root.querySelector('.lyric-overlay__next')?.textContent).toBe('第三句');
    dispose();
  });

  it('暂停快照冻结并取消调度；隐藏快照清空文本', async () => {
    const root = document.createElement('div');
    let nowMs = 0;
    const timers: { callback: () => void }[] = [];
    const { bridge, push } = createBridge(snapshot());
    const dispose = mountLyricOverlay(root, bridge, {
      now: () => nowMs,
      setTimeoutFn: (callback) => {
        timers.push({ callback });
        return timers.length;
      },
      clearTimeoutFn: () => {},
    });
    await flush();

    push(snapshot({ playing: false, positionSec: 6 }));
    const timerCount = timers.length;
    nowMs = 60_000;
    expect(timers).toHaveLength(timerCount);
    expect(root.querySelector('.lyric-overlay__current')?.textContent).toBe('第一句');

    push(snapshot({ visible: false, playing: false }));
    expect(root.dataset.visible).toBe('false');
    expect(root.querySelector('.lyric-overlay__current')?.textContent).toBe('');
    expect(root.querySelector('.lyric-overlay__next')?.textContent).toBe('');
    dispose();
  });

  it('先到推送时忽略较晚返回的 getState 快照（消除订阅竞态）', async () => {
    const root = document.createElement('div');
    let resolveState: (value: LyricOverlaySnapshot | null) => void = () => {};
    let listener: ((next: LyricOverlaySnapshot) => void) | null = null;
    const bridge: LyricOverlayBridge = {
      getState: () => new Promise((resolve) => {
        resolveState = resolve;
      }),
      onState: vi.fn((next) => {
        listener = next;
        return () => {};
      }),
    };
    const dispose = mountLyricOverlay(root, bridge, { now: () => 0, setTimeoutFn: () => 0, clearTimeoutFn: () => {} });
    listener?.(snapshot({ positionSec: 11 }));
    resolveState(snapshot({ positionSec: 1 }));
    await flush();

    expect(root.querySelector('.lyric-overlay__current')?.textContent).toBe('第二句');
    dispose();
  });
});
