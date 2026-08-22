import { describe, expect, it } from 'vitest';
import { resolveTheme } from '@/renderer/theme/theme';

describe('resolveTheme（主题三态解析）', () => {
  it('跟随系统：按系统偏好决定深浅，data-theme 留空交给 CSS', () => {
    expect(resolveTheme('system', true)).toEqual({ effectiveMode: 'dark', isDark: true, dataTheme: '' });
    expect(resolveTheme('system', false)).toEqual({ effectiveMode: 'light', isDark: false, dataTheme: '' });
  });

  it('浅色：系统即使深色也强制浅色，并写 data-theme 覆盖', () => {
    expect(resolveTheme('light', true)).toEqual({ effectiveMode: 'light', isDark: false, dataTheme: 'light' });
    expect(resolveTheme('light', false)).toEqual({ effectiveMode: 'light', isDark: false, dataTheme: 'light' });
  });

  it('深色：系统即使浅色也强制深色，并写 data-theme 覆盖', () => {
    expect(resolveTheme('dark', false)).toEqual({ effectiveMode: 'dark', isDark: true, dataTheme: 'dark' });
    expect(resolveTheme('dark', true)).toEqual({ effectiveMode: 'dark', isDark: true, dataTheme: 'dark' });
  });
});
