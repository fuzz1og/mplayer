import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'path';

export class TrayManager {
  private tray: Tray | null = null;
  private tooltip: string = 'MPlayer';
  private isPlaying: boolean = false;

  create(mainWindow: BrowserWindow): void {
    const iconPath = path.join(app.getAppPath(), 'resources', 'icon_tray.png');
    const icon = nativeImage.createFromPath(iconPath);

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
          app.exit();
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
