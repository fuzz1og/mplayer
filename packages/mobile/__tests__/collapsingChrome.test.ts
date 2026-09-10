import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CHROME_FADE_H,
  COVER_BASE_H,
  COVER_FOG_H,
  NAV_H,
  chromeRanges,
  collapsingChrome,
  createStatusBarEdge,
  fadeProgress,
  navProgress,
} from '../components/collapsingChrome';
import type { StatusBarStyle } from '../components/collapsingChrome';

/**
 * 折叠头部纯逻辑核心防回归：
 * 四个详情页（歌单 PlaylistHero / 专辑 / 歌手 / 网络歌单）共用同一套观感值，
 * 常量、进度区间、状态栏阈值边沿都必须与改造前逐值一致。
 */

const CORE_SRC = fileURLToPath(new URL('../components/collapsingChrome.ts', import.meta.url).href);

/** 典型安全区：0 / Android 状态栏 / iPhone 刘海 / 灵动岛 */
const INSETS = [0, 24, 47, 59];

describe('纯逻辑核心不依赖 react-native', () => {
  it('源码里没有 react-native / react import —— node 环境可直接单测', () => {
    const src = readFileSync(CORE_SRC, 'utf8');
    expect(src).not.toMatch(/from\s+['"]react-native['"]/);
    expect(src).not.toMatch(/from\s+['"]react['"]/);
  });
});

describe('折叠头部观感常量（改造前逐值不变）', () => {
  it('导航栏内容高 52 / 封面基准高 300 / 雾化条 64 / 淡入窗口 30', () => {
    expect(NAV_H).toBe(52);
    expect(COVER_BASE_H).toBe(300);
    expect(COVER_FOG_H).toBe(64);
    expect(CHROME_FADE_H).toBe(30);
  });

  it('封面高度含状态栏：coverH = 300 + insets.top', () => {
    for (const insetsTop of INSETS) {
      expect(collapsingChrome(insetsTop).coverH).toBe(COVER_BASE_H + insetsTop);
    }
    expect(collapsingChrome(59).coverH).toBe(359);
  });

  it('导航栏高度 = 52 + insets.top（样式里另外叠 paddingTop）', () => {
    expect(collapsingChrome(0).navH).toBe(52);
    expect(collapsingChrome(59).navH + 59).toBe(111);
  });

  it('折叠点 = coverH - navH - insets.top，任意安全区都是 248', () => {
    for (const insetsTop of INSETS) {
      const chrome = collapsingChrome(insetsTop);
      expect(chrome.collapseAt).toBe(chrome.coverH - NAV_H - insetsTop);
      expect(chrome.collapseAt).toBe(248);
    }
  });

  it('淡入窗口起点 = 折叠点 - 30（标题/图标/状态栏同一个阈值）', () => {
    for (const insetsTop of INSETS) {
      const chrome = collapsingChrome(insetsTop);
      expect(chrome.fadeStart).toBe(chrome.collapseAt - CHROME_FADE_H);
      expect(chrome.fadeStart).toBe(218);
    }
  });
});

describe('进度映射（原生插值区间同源）', () => {
  const chrome = collapsingChrome(59);

  it('navProgress：0 → collapseAt 线性，域外 clamp 到 0 / 1', () => {
    expect(navProgress(0, chrome)).toBe(0);
    expect(navProgress(124, chrome)).toBeCloseTo(0.5, 10);
    expect(navProgress(chrome.collapseAt, chrome)).toBe(1);
    expect(navProgress(-120, chrome)).toBe(0);
    expect(navProgress(10000, chrome)).toBe(1);
  });

  it('fadeProgress：fadeStart → collapseAt 线性，域外 clamp 到 0 / 1', () => {
    expect(fadeProgress(chrome.fadeStart, chrome)).toBe(0);
    expect(fadeProgress(chrome.fadeStart + CHROME_FADE_H / 2, chrome)).toBeCloseTo(0.5, 10);
    expect(fadeProgress(chrome.collapseAt, chrome)).toBe(1);
    expect(fadeProgress(chrome.fadeStart - 1, chrome)).toBe(0);
    expect(fadeProgress(10000, chrome)).toBe(1);
  });

  it('chromeRanges 的两个区间端点正是进度 0 / 1 的点', () => {
    const { solid, fade } = chromeRanges(chrome);
    expect(navProgress(solid[0], chrome)).toBe(0);
    expect(navProgress(solid[1], chrome)).toBe(1);
    expect(fadeProgress(fade[0], chrome)).toBe(0);
    expect(fadeProgress(fade[1], chrome)).toBe(1);
    expect(fade[0]).toBeLessThan(fade[1]);
  });
});

describe('状态栏阈值边沿（每穿越一次只发一次）', () => {
  const chrome = collapsingChrome(59); // fadeStart = 218，collapseAt = 248

  const run = (offsets: number[]) => {
    const seen: StatusBarStyle[] = [];
    const update = createStatusBarEdge((style) => seen.push(style));
    offsets.forEach((y) => update(y, chrome));
    return seen;
  };

  it('阈值点本身仍算浅色，跨过才转深色', () => {
    expect(run([0, 10, chrome.fadeStart - 1, chrome.fadeStart])).toEqual([]);
    expect(run([chrome.fadeStart + 1])).toEqual(['dark']);
  });

  it('同侧连续帧不重复上报（滚过整个折叠区间只发一次）', () => {
    expect(run([0, 50, 217, 218, 219, 248, 1000, 4000])).toEqual(['dark']);
  });

  it('回滚跨回阈值同样只发一次', () => {
    expect(run([0, 219, 218, 100, 0])).toEqual(['dark', 'light']);
  });

  it('来回穿越 N 次 = N 次上报（含阈值附近的抖动）', () => {
    expect(run([0, 218, 218.5, 218, 260, 300, 217, 100, 400])).toEqual([
      'dark', // 218.5 越过阈值
      'light', // 抖回阈值点 218（= 浅色）
      'dark', // 260
      'light', // 回滚到 217
      'dark', // 再次越过
    ]);
  });

  it('初始值可指定（挂载即深色时以浅色起步，随后按边沿翻转）', () => {
    const seen: StatusBarStyle[] = [];
    const update = createStatusBarEdge((style) => seen.push(style), 'dark');
    update(chrome.fadeStart, chrome); // 阈值点 = 浅色 → 翻转一次
    update(0, chrome); // 同侧，不再上报
    expect(seen).toEqual(['light']);
  });

  it('每次穿越只 setState 一次（onChange 调用次数 = 穿越次数）', () => {
    const onChange = vi.fn();
    const update = createStatusBarEdge(onChange);
    [0, 100, 218, 219, 220, 248, 249].forEach((y) => update(y, chrome));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});
