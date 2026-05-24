import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

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
  },
}));

global.window = global.window || {};
(global.window as unknown as { require: (module: string) => unknown }).require = (module: string) => {
  if (module === 'electron') {
    return {
      ipcRenderer: {
        invoke: vi.fn().mockResolvedValue({ success: true }),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };
  }
  return require(module);
};