import { vi } from 'vitest';

// Electron main process全局 mock
// 每个测试文件可用 vi.mocked() 按需重载特定方法
vi.mock('electron', () => {
  const mockApp = {
    getPath: vi.fn().mockReturnValue('/tmp/mock-user-data'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    quit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    getName: vi.fn().mockReturnValue('MPlayer'),
    getLocale: vi.fn().mockReturnValue('zh-CN'),
  };

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  };

  const mockBrowserWindow = vi.fn().mockImplementation(() => ({
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
      openDevTools: vi.fn(),
    },
    on: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    focus: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    setSize: vi.fn(),
    getSize: vi.fn().mockReturnValue([1400, 900]),
    setPosition: vi.fn(),
    getPosition: vi.fn().mockReturnValue([0, 0]),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
  }));

  const mockDialog = {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '' }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  };

  const mockSession = {
    defaultSession: {
      setProxy: vi.fn().mockResolvedValue(undefined),
      resolveProxy: vi.fn().mockResolvedValue(''),
    },
    fromPartition: vi.fn().mockReturnThis(),
  };

  const mockGlobalShortcut = {
    register: vi.fn().mockReturnValue(true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn().mockReturnValue(false),
  };

  const mockTray = vi.fn().mockImplementation(() => ({
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    displayBalloon: vi.fn(),
  }));

  const mockMenu = vi.fn().mockImplementation(() => ({
    popup: vi.fn(),
    append: vi.fn(),
    items: [],
  }));
  (mockMenu as any).buildFromTemplate = vi.fn().mockReturnValue(mockMenu());
  (mockMenu as any).setApplicationMenu = vi.fn();

  const mockNativeImage = {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: vi.fn().mockReturnValue(true) }),
    resize: vi.fn().mockReturnThis(),
    toDataURL: vi.fn().mockReturnValue(''),
  };

  return {
    app: mockApp,
    ipcMain: mockIpcMain,
    BrowserWindow: mockBrowserWindow,
    dialog: mockDialog,
    session: mockSession,
    globalShortcut: mockGlobalShortcut,
    Tray: mockTray,
    Menu: mockMenu,
    nativeImage: mockNativeImage,
    clipboard: { writeText: vi.fn(), readText: vi.fn().mockReturnValue('') },
    shell: { openExternal: vi.fn(), openPath: vi.fn() },
    screen: { getPrimaryDisplay: vi.fn().mockReturnValue({ size: { width: 1920, height: 1080 }, workArea: { width: 1920, height: 1040 } }) },
  };
});
