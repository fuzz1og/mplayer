import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Ant Design 6 tables require ResizeObserver in jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as any).ResizeObserver = (window as any).ResizeObserver || ResizeObserverMock;

// Mock window.matchMedia for Ant Design components in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue({ success: true }),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn().mockReturnValue(''),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));

// antd message/notification 静态方法内部会 ReactDOM.createRoot 挂载游离 root 到
// document.body，RTL auto-cleanup 覆盖不到，scheduler 异步任务会在 jsdom 环境销毁后
// 执行 → ReferenceError: window is not defined（CI node 22 偶发 flaky）。
// 全局 stub 掉这些静态方法，避免创建游离 React root。需要验证弹层行为的测试再局部 mock。
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  const stub = () => vi.fn(() => Promise.resolve());
  return {
    ...actual,
    message: {
      info: stub(),
      success: stub(),
      error: stub(),
      warning: stub(),
      loading: stub(),
      open: stub(),
    },
    notification: {
      open: stub(),
      success: stub(),
      error: stub(),
      warning: stub(),
      info: stub(),
    },
  };
});

global.window = global.window || {};
(global.window as unknown as { require: (module: string) => unknown }).require = (module: string) => {
  if (module === 'electron') {
    return {
      ipcRenderer: {
        invoke: vi.fn().mockResolvedValue({ success: true }),
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn(),
        removeAllListeners: vi.fn(),
      },
      clipboard: {
        writeText: vi.fn(),
        readText: vi.fn().mockReturnValue(''),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
    };
  }
  return require(module);
};
