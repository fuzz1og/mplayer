import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow, BrowserWindowConstructorOptions, Display, Rectangle } from 'electron';
import {
  LYRIC_OVERLAY_SIZES,
  LYRIC_OVERLAY_STATE_CHANNEL,
  type LyricsSize,
  type LyricOverlaySnapshot,
} from '../../shared/lyricOverlay';
import {
  clampBoundsToWorkArea,
  defaultBoundsForDisplay,
  displayContainingBounds,
  resolveBounds,
  sanitizeStoredBounds,
  type FloatingLyricsBoundsRecord,
} from './overlayBounds';

export interface LyricOverlayLoadTarget {
  kind: 'url' | 'file';
  value: string;
}

export interface LyricOverlayWindowDeps {
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  getDisplays(): Display[];
  getPrimaryDisplay(): Display;
  loadStoredBounds(): Promise<FloatingLyricsBoundsRecord | undefined>;
  persistBounds(bounds: FloatingLyricsBoundsRecord): void;
  subscribeDisplayChanges(listener: () => void): () => void;
  showContextMenu(window: BrowserWindow): void;
  preloadPath: string;
  loadTarget: LyricOverlayLoadTarget;
  devServerUrl?: string | null;
}

export const BOUNDS_PERSIST_DEBOUNCE_MS = 400;
export const OVERLAY_KEEPALIVE_MS = 1000;

function sameRectangle(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * 覆盖层窗口唯一持有者（ADR 2026-11-19-desktop-lyric-overlay-window）：
 * enabled 决定生灭、visible 决定显隐，主进程只执行不重算歌词语义。
 */
export class LyricOverlayWindowController {
  private readonly deps: LyricOverlayWindowDeps;
  private window: BrowserWindow | null = null;
  private cached: LyricOverlaySnapshot | null = null;
  private stored: FloatingLyricsBoundsRecord = {};
  private lastBounds: Rectangle | null = null;
  private expectedBounds: Rectangle | null = null;
  private appliedSize: LyricsSize | null = null;
  private ready = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeDisplay: (() => void) | null = null;

  constructor(deps: LyricOverlayWindowDeps) {
    this.deps = deps;
  }

  async init(): Promise<void> {
    try {
      this.stored = sanitizeStoredBounds(await this.deps.loadStoredBounds());
    } catch {
      // 坏存档不阻断启动：位置回到默认位
      this.stored = {};
    }
    this.unsubscribeDisplay = this.deps.subscribeDisplayChanges(() => this.handleDisplayChange());
  }

  getCachedSnapshot(): LyricOverlaySnapshot | null {
    return this.cached;
  }

  getOverlayWebContentsId(): number | null {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window.webContents.id;
  }

  applySnapshot(snapshot: LyricOverlaySnapshot): void {
    this.cached = snapshot;
    if (!snapshot.enabled) {
      this.destroyWindow();
      return;
    }
    if (!this.window) {
      if (snapshot.visible) this.createWindow(snapshot.lyricsSize);
      return;
    }
    this.applySize(snapshot.lyricsSize);
    if (!snapshot.visible) {
      // 隐藏前也要送达最后一份快照：否则隐藏文档保留上一首的行 / 定时器，重显首帧会闪旧词。
      this.sendSnapshot(snapshot);
      this.hideWindow();
      return;
    }
    this.sendSnapshot(snapshot);
    this.showWindow();
  }

  /** 主窗渲染进程崩溃：播放宿主已停，旧快照必过期 → 先隐藏，等新快照。 */
  handleMainRendererGone(): void {
    this.hideWindow();
  }

  resetPosition(): void {
    const window = this.window && !this.window.isDestroyed() ? this.window : null;
    const display = window ? this.displayForBounds(window.getBounds()) : this.deps.getPrimaryDisplay();
    delete this.stored[String(display.id)];
    this.deps.persistBounds(this.stored);
    if (!window) return;
    const sizeKey = this.appliedSize ?? this.cached?.lyricsSize ?? 'standard';
    this.setBoundsProgrammatically(defaultBoundsForDisplay(display.workArea, LYRIC_OVERLAY_SIZES[sizeKey]));
  }

  dispose(): void {
    this.unsubscribeDisplay?.();
    this.unsubscribeDisplay = null;
    this.destroyWindow();
  }

  /**
   * 冷启动（无内存位置）的落点显示器：主屏有记录用主屏；否则用记录所在的显示器；
   * 都没有（缺屏 / 首次运行）回落主屏底部居中。
   */
  private restoreDisplay(): Display {
    const primary = this.deps.getPrimaryDisplay();
    if (this.stored[String(primary.id)]) return primary;
    const recorded = this.deps
      .getDisplays()
      .find((display) => this.stored[String(display.id)] !== undefined);
    return recorded ?? primary;
  }

  private createWindow(sizeKey: LyricsSize): void {
    const size = LYRIC_OVERLAY_SIZES[sizeKey];
    const displays = this.deps.getDisplays();
    const display = this.lastBounds
      ? displayContainingBounds(this.lastBounds, displays, this.deps.getPrimaryDisplay())
      : this.restoreDisplay();
    const bounds = this.lastBounds
      ? clampBoundsToWorkArea({ x: this.lastBounds.x, y: this.lastBounds.y, ...size }, display.workArea)
      : resolveBounds(this.stored[String(display.id)], display.workArea, size);

    const window = this.deps.createWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
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
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: true,
      },
    });

    this.window = window;
    this.ready = false;
    this.appliedSize = sizeKey;
    this.lastBounds = bounds;
    this.expectedBounds = bounds;
    this.attachWindowHandlers(window);

    if (this.deps.loadTarget.kind === 'url') window.loadURL(this.deps.loadTarget.value);
    else window.loadFile(this.deps.loadTarget.value);
  }

  private attachWindowHandlers(window: BrowserWindow): void {
    window.once('ready-to-show', () => {
      if (this.window !== window) return;
      this.ready = true;
      if (this.cached?.enabled && this.cached.visible) this.showWindow();
    });
    window.on('move', () => this.handleMove());
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    window.on('system-context-menu', (event: Electron.Event) => {
      event.preventDefault();
      this.deps.showContextMenu(window);
    });
    window.webContents.on('context-menu', () => this.deps.showContextMenu(window));
    window.webContents.on('render-process-gone', () => {
      if (this.window !== window) return;
      this.handleOverlayRendererGone();
    });
    window.webContents.on('will-navigate', (event: Electron.Event, url: string) => {
      if (!this.isAllowedNavigation(url)) {
        console.warn(`[Security] 已拦截覆盖层导航: ${url}`);
        event.preventDefault();
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  private showWindow(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
    if (!window.isVisible()) {
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
    }
    this.startKeepAlive();
  }

  private hideWindow(): void {
    this.stopKeepAlive();
    this.flushPendingPersist();
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.webContents.setBackgroundThrottling(true);
    window.hide();
  }

  private destroyWindow(): void {
    this.stopKeepAlive();
    this.flushPendingPersist();
    const window = this.window;
    this.window = null;
    this.ready = false;
    this.appliedSize = null;
    this.lastBounds = null;
    this.expectedBounds = null;
    if (window && !window.isDestroyed()) window.destroy();
  }

  private handleOverlayRendererGone(): void {
    const window = this.window;
    if (!window) return;
    const bounds = window.isDestroyed() ? this.lastBounds : window.getBounds();
    const cached = this.cached;
    this.destroyWindow();
    this.lastBounds = bounds;
    if (cached?.enabled && cached.visible) this.createWindow(cached.lyricsSize);
  }

  private applySize(sizeKey: LyricsSize): void {
    const window = this.window;
    if (!window || window.isDestroyed() || this.appliedSize === sizeKey) return;
    const size = LYRIC_OVERLAY_SIZES[sizeKey];
    const current = window.getBounds();
    const display = this.displayForBounds(current);
    this.appliedSize = sizeKey;
    this.setBoundsProgrammatically(clampBoundsToWorkArea({ x: current.x, y: current.y, ...size }, display.workArea));
  }

  private handleMove(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    this.lastBounds = bounds;
    if (this.expectedBounds && sameRectangle(bounds, this.expectedBounds)) {
      this.expectedBounds = null;
      return;
    }
    this.expectedBounds = null;
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistBoundsNow();
    }, BOUNDS_PERSIST_DEBOUNCE_MS);
  }

  private flushPendingPersist(): void {
    if (!this.persistTimer) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.persistBoundsNow();
  }

  private persistBoundsNow(): void {
    if (!this.lastBounds) return;
    const display = this.displayForBounds(this.lastBounds);
    this.stored = { ...this.stored, [String(display.id)]: { ...this.lastBounds } };
    this.deps.persistBounds(this.stored);
  }

  private setBoundsProgrammatically(bounds: Rectangle): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    this.expectedBounds = bounds;
    this.lastBounds = bounds;
    window.setBounds(bounds);
  }

  private handleDisplayChange(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const current = window.getBounds();
    const display = this.displayForBounds(current);
    const clamped = clampBoundsToWorkArea(current, display.workArea);
    if (!sameRectangle(current, clamped)) this.setBoundsProgrammatically(clamped);
    if (this.cached?.enabled && this.cached.visible && this.ready) {
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
    }
  }

  private displayForBounds(bounds: Rectangle): Display {
    return displayContainingBounds(bounds, this.deps.getDisplays(), this.deps.getPrimaryDisplay());
  }

  private sendSnapshot(snapshot: LyricOverlaySnapshot): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(LYRIC_OVERLAY_STATE_CHANNEL, snapshot);
  }

  private startKeepAlive(): void {
    if (this.keepAliveTimer) return;
    this.keepAliveTimer = setInterval(() => {
      const window = this.window;
      if (!window || window.isDestroyed() || !window.isVisible()) return;
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
    }, OVERLAY_KEEPALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (!this.keepAliveTimer) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private isAllowedNavigation(url: string): boolean {
    const target = this.deps.loadTarget;
    try {
      const parsed = new URL(url);
      if (target.kind === 'url') {
        if (this.deps.devServerUrl) return parsed.origin === new URL(this.deps.devServerUrl).origin;
        return parsed.href === new URL(target.value).href;
      }
      if (parsed.protocol !== 'file:') return false;
      return path.resolve(fileURLToPath(parsed)) === path.resolve(target.value);
    } catch {
      return false;
    }
  }
}
