import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';

export class TrayManager {
  private tray: Tray | null = null;
  private tooltip: string = 'MPlayer';
  private isPlaying: boolean = false;

  create(mainWindow: BrowserWindow): void {
    const iconSize = 16;
    const canvas = Buffer.alloc(iconSize * iconSize * 4);

    for (let y = 0; y < iconSize; y++) {
      for (let x = 0; x < iconSize; x++) {
        const idx = (y * iconSize + x) * 4;
        const inTriangle = x >= 4 && x <= 12 && y >= 3 && y <= 12 &&
          y >= (3 + (x - 4) * 0.9) && y <= (12 - (x - 4) * 0.9);
        if (inTriangle) {
          canvas[idx] = 116;
          canvas[idx + 1] = 185;
          canvas[idx + 2] = 255;
          canvas[idx + 3] = 255;
        } else {
          canvas[idx + 3] = 0;
        }
      }
    }

    const icon = nativeImage.createFromBuffer(
      Buffer.from(canvas),
      { width: iconSize, height: iconSize }
    );

    this.tray = new Tray(icon);
    this.tray.setToolTip(this.tooltip);
    this.updateMenu(mainWindow);
  }

  private updateMenu(mainWindow: BrowserWindow): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `🎵 ${this.tooltip}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: this.isPlaying ? '⏸ 暂停' : '▶ 播放',
        click: () => {
          mainWindow.webContents.send('tray:action', { type: 'playPause' });
        },
      },
      {
        label: '⏮ 上一首',
        click: () => {
          mainWindow.webContents.send('tray:action', { type: 'prev' });
        },
      },
      {
        label: '⏭ 下一首',
        click: () => {
          mainWindow.webContents.send('tray:action', { type: 'next' });
        },
      },
      { type: 'separator' },
      {
        label: '🪟 显示窗口',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: '✕ 退出',
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  updateSongInfo(songName: string, artist: string): void {
    this.tooltip = `${songName} - ${artist}`;
    if (this.tray) {
      this.tray.setToolTip(this.tooltip);
    }
  }

  updatePlayState(isPlaying: boolean): void {
    this.isPlaying = isPlaying;
  }

  refreshMenu(mainWindow: BrowserWindow): void {
    this.updateMenu(mainWindow);
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
