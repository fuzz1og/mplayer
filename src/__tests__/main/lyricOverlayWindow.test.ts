import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, BrowserWindowConstructorOptions, Display, Rectangle } from 'electron';
import {
  LyricOverlayWindowController,
  type LyricOverlayWindowDeps,
} from '@/main/lyricOverlay/lyricOverlayWindow';
import type { LyricOverlaySnapshot } from '@/shared/lyricOverlay';

const PRELOAD = 'C:\\app\\dist-electron\\lyricOverlayPreload.js';
const OVERLAY_FILE = 'C:\\app\\dist\\lyric-overlay.html';
const CHANNEL = 'lyricOverlay:state';

class FakeWebContents {
  static nextId = 1;
  readonly id = FakeWebContents.nextId++;
  send = vi.fn();
  setBackgroundThrottling = vi.fn();
  setWindowOpenHandler = vi.fn();
  private handlers = new Map<string, ((...args: any[]) => void)[]>();

  on(event: string, callback: (...args: any[]) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), callback]);
    return this;
  }

  emit(event: string, ...args: any[]): void {
    for (const callback of this.handlers.get(event) ?? []) callback(...args);
  }
}

class FakeWindow {
  static nextId = 1;
  readonly id = FakeWindow.nextId++;
  readonly webContents = new FakeWebContents();
  readonly options: BrowserWindowConstructorOptions;
  bounds: Rectangle;
  destroyed = false;
  visible = false;
  setAlwaysOnTop = vi.fn();
  moveTop = vi.fn();
  loadURL = vi.fn();
  loadFile = vi.fn();
  setBoundsCalls: Rectangle[] = [];
  private handlers = new Map<string, ((...args: any[]) => void)[]>();
  private onceHandlers = new Map<string, ((...args: any[]) => void)[]>();

  constructor(options: BrowserWindowConstructorOptions) {
    this.options = options;
    this.bounds = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 0,
      height: options.height ?? 0,
    };
  }

  on(event: string, callback: (...args: any[]) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), callback]);
    return this;
  }

  once(event: string, callback: (...args: any[]) => void): this {
    this.onceHandlers.set(event, [...(this.onceHandlers.get(event) ?? []), callback]);
    return this;
  }

  emit(event: string, ...args: any[]): void {
    for (const callback of this.handlers.get(event) ?? []) callback(...args);
    const once = this.onceHandlers.get(event) ?? [];
    this.onceHandlers.delete(event);
    for (const callback of once) callback(...args);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  showInactive(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  destroy(): void {
    this.destroyed = true;
    this.visible = false;
    this.emit('closed');
  }

  getBounds(): Rectangle {
    return { ...this.bounds };
  }

  setBounds(bounds: Rectangle): void {
    this.bounds = { ...bounds };
    this.setBoundsCalls.push({ ...bounds });
    this.emit('move');
  }
}

const primaryDisplay = {
  id: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
} as Display;

const secondDisplay = {
  id: 2,
  workArea: { x: 1920, y: 0, width: 1280, height: 1024 },
  bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
} as Display;

function snapshot(overrides: Partial<LyricOverlaySnapshot> = {}): LyricOverlaySnapshot {
  return {
    enabled: true,
    visible: true,
    playing: true,
    songId: 'song-1',
    lyricsText: '[00:01.00]第一句',
    positionSec: 2,
    durationSec: 30,
    lyricsSize: 'standard',
    ...overrides,
  };
}

function setup(overrides: Partial<LyricOverlayWindowDeps> = {}) {
  const windows: FakeWindow[] = [];
  let displayListener: (() => void) | null = null;
  const deps: LyricOverlayWindowDeps = {
    createWindow: vi.fn((options: BrowserWindowConstructorOptions) => {
      const window = new FakeWindow(options);
      windows.push(window);
      return window as unknown as BrowserWindow;
    }),
    getDisplays: () => [primaryDisplay, secondDisplay],
    getPrimaryDisplay: () => primaryDisplay,
    loadStoredBounds: vi.fn(async () => ({})),
    persistBounds: vi.fn(),
    subscribeDisplayChanges: vi.fn((listener: () => void) => {
      displayListener = listener;
      return () => {
        displayListener = null;
      };
    }),
    showContextMenu: vi.fn(),
    preloadPath: PRELOAD,
    loadTarget: { kind: 'file', value: OVERLAY_FILE },
    devServerUrl: null,
    ...overrides,
  };
  const controller = new LyricOverlayWindowController(deps);
  return { controller, deps, windows, emitDisplayChange: () => displayListener?.() };
}

function ready(windows: FakeWindow[], index = 0): FakeWindow {
  windows[index].emit('ready-to-show');
  return windows[index];
}

describe('悬浮歌词窗口控制器（#765 / #766 / #769）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enabled=false 不建窗；已有窗口立即销毁（即使 visible=false）', async () => {
    const { controller, windows } = setup();
    await controller.init();
    controller.applySnapshot(snapshot({ enabled: false, visible: false }));
    expect(windows).toHaveLength(0);

    controller.applySnapshot(snapshot());
    expect(windows).toHaveLength(1);
    controller.applySnapshot(snapshot({ enabled: false, visible: false }));
    expect(windows[0].destroyed).toBe(true);
  });

  it('enabled=true + visible=false 不创建隐藏窗；已有窗口只 hide', async () => {
    const { controller, windows } = setup();
    await controller.init();
    controller.applySnapshot(snapshot({ visible: false }));
    expect(windows).toHaveLength(0);

    controller.applySnapshot(snapshot());
    ready(windows);
    controller.applySnapshot(snapshot({ visible: false }));
    expect(windows).toHaveLength(1);
    expect(windows[0].destroyed).toBe(false);
    expect(windows[0].visible).toBe(false);
    expect(windows[0].webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
  });

  it('创建参数与 ready-to-show 后 showInactive；置顶续命每秒一次且隐藏即停', async () => {
    const { controller, windows } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());

    const window = windows[0];
    expect(window.options).toMatchObject({
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      resizable: false,
      fullscreenable: false,
      width: 520,
      height: 112,
    });
    expect(window.options.webPreferences).toMatchObject({
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    expect(window.loadFile).toHaveBeenCalledWith(OVERLAY_FILE);
    expect(window.visible).toBe(false);

    ready(windows);
    expect(window.visible).toBe(true);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(window.moveTop).toHaveBeenCalled();
    expect(window.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false);

    window.setAlwaysOnTop.mockClear();
    window.moveTop.mockClear();
    vi.advanceTimersByTime(1000);
    expect(window.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(window.moveTop).toHaveBeenCalledTimes(1);

    controller.applySnapshot(snapshot({ visible: false }));
    window.setAlwaysOnTop.mockClear();
    window.moveTop.mockClear();
    vi.advanceTimersByTime(3000);
    expect(window.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(window.moveTop).not.toHaveBeenCalled();
  });

  it('复用已建窗口并推送快照到覆盖层 webContents', async () => {
    const { controller, windows } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());
    ready(windows);
    windows[0].webContents.send.mockClear();

    controller.applySnapshot(snapshot({ positionSec: 9 }));
    expect(windows).toHaveLength(1);
    expect(windows[0].visible).toBe(true);
    expect(windows[0].webContents.send).toHaveBeenCalledWith(CHANNEL, snapshot({ positionSec: 9 }));
    expect(controller.getOverlayWebContentsId()).toBe(windows[0].webContents.id);
  });

  it('按 display.id 记录恢复：存储左上角 + 当前档位尺寸；缺屏回主屏底部居中', async () => {
    const loadStoredBounds = vi.fn(async () => ({
      '1': { x: 100, y: 200, width: 520, height: 112 },
    }));
    const first = setup({ loadStoredBounds });
    await first.controller.init();
    first.controller.applySnapshot(snapshot());
    expect(first.windows[0].bounds).toEqual({ x: 100, y: 200, width: 520, height: 112 });

    const large = setup({ loadStoredBounds });
    await large.controller.init();
    large.controller.applySnapshot(snapshot({ lyricsSize: 'large' }));
    expect(large.windows[0].bounds).toEqual({ x: 100, y: 200, width: 640, height: 112 });

    const missingDisplay = setup({
      loadStoredBounds: vi.fn(async () => ({ '99': { x: 5, y: 5, width: 520, height: 112 } })),
    });
    await missingDisplay.controller.init();
    missingDisplay.controller.applySnapshot(snapshot());
    expect(missingDisplay.windows[0].bounds).toEqual({ x: 700, y: 904, width: 520, height: 112 });
  });

  it('字号档位变化：保留左上角、换尺寸并夹紧，且不触发位置持久化', async () => {
    const { controller, windows, deps } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());
    ready(windows);
    vi.advanceTimersByTime(500);
    vi.mocked(deps.persistBounds).mockClear();

    controller.applySnapshot(snapshot({ lyricsSize: 'large' }));
    expect(windows[0].bounds).toEqual({ x: 700, y: 904, width: 640, height: 112 });
    vi.advanceTimersByTime(1000);
    expect(deps.persistBounds).not.toHaveBeenCalled();
  });

  it('拖动落位防抖后按落点显示器记录 getBounds() 外框', async () => {
    const { controller, windows, deps } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());
    ready(windows);
    vi.advanceTimersByTime(500);
    vi.mocked(deps.persistBounds).mockClear();

    windows[0].bounds = { x: 2500, y: 300, width: 520, height: 112 };
    windows[0].emit('move');
    expect(deps.persistBounds).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(deps.persistBounds).toHaveBeenCalledWith({
      '2': { x: 2500, y: 300, width: 520, height: 112 },
    });
  });

  it('display-metrics-changed 后重新夹紧并立即续置顶', async () => {
    const { controller, windows, emitDisplayChange } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());
    ready(windows);
    windows[0].setAlwaysOnTop.mockClear();
    windows[0].moveTop.mockClear();

    windows[0].bounds = { x: 3100, y: 300, width: 520, height: 112 };
    emitDisplayChange();
    expect(windows[0].bounds.x).toBe(3200 - 520);
    expect(windows[0].setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  });

  it('覆盖层崩溃按上次 bounds 重建并恢复显示；主窗渲染进程崩溃先隐藏', async () => {
    const { controller, windows } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());
    ready(windows);
    windows[0].bounds = { x: 300, y: 400, width: 520, height: 112 };

    windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(windows).toHaveLength(2);
    expect(windows[1].bounds).toMatchObject({ x: 300, y: 400, width: 520, height: 112 });
    ready(windows, 1);
    expect(windows[1].visible).toBe(true);

    controller.handleMainRendererGone();
    expect(windows[1].visible).toBe(false);
    expect(windows[1].destroyed).toBe(false);
  });

  it('右键只有重置位置：system-context-menu 与 webContents context-menu 都走注入菜单', async () => {
    const { controller, windows, deps } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());
    ready(windows);

    const systemEvent = { preventDefault: vi.fn() };
    windows[0].emit('system-context-menu', systemEvent);
    expect(systemEvent.preventDefault).toHaveBeenCalled();
    expect(deps.showContextMenu).toHaveBeenCalledWith(windows[0]);

    windows[0].webContents.emit('context-menu', {}, {});
    expect(deps.showContextMenu).toHaveBeenCalledTimes(2);
  });

  it('导航守卫：只放行自身页面；window.open 一律 deny', async () => {
    const { controller, windows } = setup();
    await controller.init();
    controller.applySnapshot(snapshot());

    const blocked = { preventDefault: vi.fn() };
    windows[0].webContents.emit('will-navigate', blocked, 'https://evil.example/');
    expect(blocked.preventDefault).toHaveBeenCalled();

    const allowed = { preventDefault: vi.fn() };
    windows[0].webContents.emit('will-navigate', allowed, 'file:///C:/app/dist/lyric-overlay.html');
    expect(allowed.preventDefault).not.toHaveBeenCalled();

    const handler = windows[0].webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' });
  });

  it('重置位置只删当前屏记录，并按该屏底部居中重放', async () => {
    const loadStoredBounds = vi.fn(async () => ({
      '1': { x: 100, y: 200, width: 520, height: 112 },
      '2': { x: 2000, y: 200, width: 520, height: 112 },
    }));
    const { controller, windows, deps } = setup({ loadStoredBounds });
    await controller.init();
    controller.applySnapshot(snapshot());
    ready(windows);

    controller.resetPosition();
    expect(deps.persistBounds).toHaveBeenCalledWith({
      '2': { x: 2000, y: 200, width: 520, height: 112 },
    });
    expect(windows[0].bounds).toEqual({ x: 700, y: 904, width: 520, height: 112 });
  });

  it('dev 模式 loadURL 到 lyric-overlay.html，导航只放行 dev 同源', async () => {
    const { controller, windows } = setup({
      loadTarget: { kind: 'url', value: 'http://localhost:5174/lyric-overlay.html' },
      devServerUrl: 'http://localhost:5174',
    });
    await controller.init();
    controller.applySnapshot(snapshot());
    expect(windows[0].loadURL).toHaveBeenCalledWith('http://localhost:5174/lyric-overlay.html');

    const allowed = { preventDefault: vi.fn() };
    windows[0].webContents.emit('will-navigate', allowed, 'http://localhost:5174/lyric-overlay.html');
    expect(allowed.preventDefault).not.toHaveBeenCalled();

    const blocked = { preventDefault: vi.fn() };
    windows[0].webContents.emit('will-navigate', blocked, 'http://localhost:5174.evil.example/');
    expect(blocked.preventDefault).toHaveBeenCalled();
  });
});
