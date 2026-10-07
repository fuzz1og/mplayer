import { beforeEach, describe, expect, it } from 'vitest';
import { shouldPromptUpdate, UPDATE_PROMPT_DELAY_MS } from '../services/appUpdatePrompt';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * 启动更新弹窗的判据与忽略粒度（#579 / ADR 决策 6、不变量 I7）。
 * 纯函数 + store 动作，零网络。
 */
describe('启动更新弹窗（#579）', () => {
  beforeEach(() => {
    useSettingsStore.setState({ dismissedUpdateVersion: null });
  });

  describe('shouldPromptUpdate', () => {
    it('有新版本且没忽略过 → 弹', () => {
      expect(shouldPromptUpdate('1.9.0', null)).toBe(true);
    });

    it('该版本已被「叉掉」 → 不弹', () => {
      expect(shouldPromptUpdate('1.9.0', '1.9.0')).toBe(false);
    });

    it('忽略的是旧版本 → 新版本仍然弹（粒度 = 版本号）', () => {
      expect(shouldPromptUpdate('1.9.1', '1.9.0')).toBe(true);
    });

    it('检查没拿到版本号 → 不弹（不弹一个没有版本号的窗）', () => {
      expect(shouldPromptUpdate(undefined, null)).toBe(false);
      expect(shouldPromptUpdate(null, null)).toBe(false);
      expect(shouldPromptUpdate('', null)).toBe(false);
    });
  });

  describe('忽略版本持久化', () => {
    it('setDismissedUpdateVersion 写入并可清空', () => {
      useSettingsStore.getState().setDismissedUpdateVersion('1.9.0');
      expect(useSettingsStore.getState().dismissedUpdateVersion).toBe('1.9.0');

      useSettingsStore.getState().setDismissedUpdateVersion(null);
      expect(useSettingsStore.getState().dismissedUpdateVersion).toBeNull();
    });

    it('忽略后同一版本不再弹（判据串起来的行为）', () => {
      expect(shouldPromptUpdate('1.9.0', useSettingsStore.getState().dismissedUpdateVersion)).toBe(true);
      useSettingsStore.getState().setDismissedUpdateVersion('1.9.0');
      expect(shouldPromptUpdate('1.9.0', useSettingsStore.getState().dismissedUpdateVersion)).toBe(false);
    });
  });

  it('启动检查延时为正数：不阻塞首帧', () => {
    expect(UPDATE_PROMPT_DELAY_MS).toBeGreaterThan(0);
  });
});
