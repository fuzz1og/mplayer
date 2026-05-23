import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

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