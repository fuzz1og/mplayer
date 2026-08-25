import { describe, expect, it } from 'vitest';
import {
  TOP_BAR_FIXED_HEIGHT,
  TOP_BAR_PAD_VERTICAL,
  SEARCH_BAR_HEIGHT,
  PLAYER_BAR_HEIGHT,
  TAB_PAD_TOP,
  TAB_ICON_SIZE,
  TAB_LABEL_HEIGHT,
  TAB_PAD_BOTTOM,
  TAB_SAFE_INSET_MIN,
  tabBarHeight,
  bottomChromeHeight,
  topChromeHeight,
} from '../components/chromeMetrics';

/**
 * chromeMetrics 单一事实源防回归：
 * 组件样式（TopBar / (tabs)/_layout）引用这些常量，此处断言
 * 「组合值 === 既有观感值」，双写失同步会在 CI 亮红灯。
 */

describe('TopBar 固定高度（TOP_BAR_FIXED_HEIGHT）', () => {
  it('由 paddingVertical×2 + 搜索栏高度推导为 52', () => {
    expect(TOP_BAR_PAD_VERTICAL).toBe(8);
    expect(SEARCH_BAR_HEIGHT).toBe(36);
    expect(TOP_BAR_FIXED_HEIGHT).toBe(TOP_BAR_PAD_VERTICAL * 2 + SEARCH_BAR_HEIGHT);
    expect(TOP_BAR_FIXED_HEIGHT).toBe(52);
  });
});

describe('tab 栏公式（tabBarHeight）', () => {
  it('常量组成与 chromeMetrics 内部一致', () => {
    expect(TAB_PAD_TOP).toBe(6);
    expect(TAB_ICON_SIZE).toBe(22);
    expect(TAB_LABEL_HEIGHT).toBe(15);
    expect(TAB_PAD_BOTTOM).toBe(24);
    expect(TAB_SAFE_INSET_MIN).toBe(8);
  });

  it('tabBarHeight = 常量之和 + max(0, insetsBottom - 8)', () => {
    const insets = 34;
    const expected = TAB_PAD_TOP + TAB_ICON_SIZE + TAB_LABEL_HEIGHT + TAB_PAD_BOTTOM + Math.max(0, insets - TAB_SAFE_INSET_MIN);
    expect(tabBarHeight(insets)).toBe(expected);
  });

  it('安全区不足 8 时按 0 计（不产生负值）', () => {
    expect(tabBarHeight(4)).toBe(TAB_PAD_TOP + TAB_ICON_SIZE + TAB_LABEL_HEIGHT + TAB_PAD_BOTTOM);
    expect(tabBarHeight(0)).toBe(TAB_PAD_TOP + TAB_ICON_SIZE + TAB_LABEL_HEIGHT + TAB_PAD_BOTTOM);
  });

  it('既有观感值：无安全区 67 / 常见 insets.bottom=34 时 93', () => {
    expect(tabBarHeight(0)).toBe(6 + 22 + 15 + 24);
    expect(tabBarHeight(34)).toBe(6 + 22 + 15 + 24 + (34 - 8));
  });
});

describe('bottomChromeHeight / topChromeHeight', () => {
  it('tab 可见 = 播放栏 + tab 栏；不可见 = 播放栏 + 安全区', () => {
    expect(bottomChromeHeight(34, true)).toBe(PLAYER_BAR_HEIGHT + tabBarHeight(34));
    expect(bottomChromeHeight(34, false)).toBe(PLAYER_BAR_HEIGHT + 34);
  });

  it('首次播放前（playerVisible=false）播放栏高度贡献为 0（ADR-0008）', () => {
    expect(bottomChromeHeight(34, true, false)).toBe(tabBarHeight(34));
    expect(bottomChromeHeight(34, false, false)).toBe(34);
  });

  it('topChromeHeight = insetsTop + 固定高度', () => {
    expect(topChromeHeight(47)).toBe(47 + TOP_BAR_FIXED_HEIGHT);
  });
});
