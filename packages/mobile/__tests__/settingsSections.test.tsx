// @vitest-environment jsdom
import { Profiler, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 设置页拆段（#425）区段级测试。
 *
 * 环境说明：mobile 的 vitest 是 node env，本文件用 `@vitest-environment jsdom` 覆盖，
 * 并由 vitest.config.ts 把 `react-native` 别名到 `react-native-web`（只在测试里替换，
 * Metro 打包不受影响）；native 专有模块（图标 / expo-constants / 服务层）在本文件 mock。
 *
 * 覆盖两件事：
 * 1. 每个区段能**独立挂载**（不炸、渲染出自己的内容）；
 * 2. **渲染隔离**——区段自治（自订阅、自持局部状态）后，一处状态变化不重渲染其它区段。
 */

vi.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    CircleCheck: Icon,
    RefreshCcw: Icon,
    RefreshCw: Icon,
    Download: Icon,
    CircleX: Icon,
    Trash2: Icon,
    Plus: Icon,
    Gauge: Icon,
    Share2: Icon,
  };
});

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '9.9.9' } } }));

vi.mock('expo-router', () => ({ Stack: { Screen: () => null } }));

vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

vi.mock('../services/cacheService', () => ({
  getCacheStats: vi.fn(async () => ({ fileCount: 3, totalSize: 1024 * 1024 })),
  cacheKernel: { clear: vi.fn(async () => undefined) },
}));

vi.mock('../services/playbackTrace', () => ({
  listPlaybackTraces: () => [],
  clearPlaybackTraces: vi.fn(),
  exportPlaybackTraces: vi.fn(async () => '/tmp/traces.json'),
}));

vi.mock('../services/appUpdate', () => ({
  checkLatestRelease: vi.fn(),
  speedTestChannels: vi.fn(async () => []),
}));

import { useSettingsStore } from '../stores/settingsStore';
import AppearanceSection from '../components/settings/AppearanceSection';
import PlaybackSection from '../components/settings/PlaybackSection';
import DirectStatusSection from '../components/settings/DirectStatusSection';
import Tier3Section from '../components/settings/Tier3Section';
import DiagnosticsSection from '../components/settings/DiagnosticsSection';
import CacheSection from '../components/settings/CacheSection';
import AboutSection from '../components/settings/AboutSection';
import UpdateSection from '../components/settings/UpdateSection';
import SettingsPage from '../app/settings';

/** 各区段 + 一段「挂载后必然出现」的自身文案（证明真的渲染了，不只是没抛异常） */
const SECTIONS: { name: string; node: ReactNode; text: string }[] = [
  { name: 'AppearanceSection', node: <AppearanceSection />, text: '跟随系统' },
  { name: 'PlaybackSection', node: <PlaybackSection />, text: '失败即跳' },
  { name: 'DirectStatusSection', node: <DirectStatusSection />, text: '直连状态' },
  { name: 'Tier3Section', node: <Tier3Section />, text: '添加 URL 订阅' },
  { name: 'DiagnosticsSection', node: <DiagnosticsSection />, text: '暂无播放诊断记录。播放一首歌后回到这里查看解析链。' },
  { name: 'CacheSection', node: <CacheSection />, text: '清理缓存' },
  { name: 'AboutSection', node: <AboutSection />, text: '当前版本' },
  { name: 'UpdateSection', node: <UpdateSection />, text: '下载通道' },
];

beforeEach(() => {
  useSettingsStore.setState({ themeMode: 'system', updateChannel: 'auto', tier3Enabled: false, tier3Subscriptions: [], autoSkipOnError: true });
});

afterEach(() => {
  cleanup();
});

describe('设置页区段（#425）', () => {
  it('每个区段都能独立挂载并渲染自己的内容', () => {
    for (const { name, node, text } of SECTIONS) {
      const { unmount } = render(node);
      expect(screen.getByText(text), name).toBeTruthy();
      unmount();
    }
  });

  it('切主题只重渲染外观区段（不牵动 tier3 / 更新 / 缓存 / 诊断）', async () => {
    const counts: Record<string, number> = {};
    const track = (id: string, node: ReactNode) => (
      <Profiler id={id} onRender={() => { counts[id] = (counts[id] ?? 0) + 1; }}>
        {node}
      </Profiler>
    );
    // CacheSection 的统计是异步 effect 拉的：先让它落地，再取基线计数
    await act(async () => {
      render(
        <>
          {track('appearance', <AppearanceSection />)}
          {track('tier3', <Tier3Section />)}
          {track('update', <UpdateSection />)}
          {track('cache', <CacheSection />)}
          {track('diagnostics', <DiagnosticsSection />)}
        </>,
      );
    });
    const before = { ...counts };

    // system → light：jsdom 下解析出的深浅色不变（colors 引用不变），
    // 因此这是一次纯粹的「局部 store 变化」——只有订阅 themeMode 的区段该重渲染。
    act(() => {
      useSettingsStore.getState().setThemeMode('light');
    });

    expect(counts.appearance).toBe(before.appearance + 1);
    expect(counts.tier3).toBe(before.tier3);
    expect(counts.update).toBe(before.update);
    expect(counts.cache).toBe(before.cache);
    expect(counts.diagnostics).toBe(before.diagnostics);
  });

  it('tier3 输入框打字只重渲染 tier3 区段', () => {
    const counts: Record<string, number> = {};
    const track = (id: string, node: ReactNode) => (
      <Profiler id={id} onRender={() => { counts[id] = (counts[id] ?? 0) + 1; }}>
        {node}
      </Profiler>
    );
    render(
      <>
        {track('appearance', <AppearanceSection />)}
        {track('tier3', <Tier3Section />)}
        {track('about', <AboutSection />)}
      </>,
    );
    const before = { ...counts };

    fireEvent.change(screen.getByPlaceholderText('https://example.com/manifest.json'), {
      target: { value: 'https://example.com/manifest.json' },
    });

    expect(counts.tier3).toBe(before.tier3 + 1);
    expect(counts.appearance).toBe(before.appearance);
    expect(counts.about).toBe(before.about);
  });

  it('切下载通道 / 展开通道只重渲染更新区段（about 的版本行不动）', () => {
    const counts: Record<string, number> = {};
    const track = (id: string, node: ReactNode) => (
      <Profiler id={id} onRender={() => { counts[id] = (counts[id] ?? 0) + 1; }}>
        {node}
      </Profiler>
    );
    render(
      <>
        {track('appearance', <AppearanceSection />)}
        {track('tier3', <Tier3Section />)}
        {track('update', <UpdateSection />)}
      </>,
    );
    const before = { ...counts };

    act(() => {
      useSettingsStore.getState().setUpdateChannel('github');
    });
    expect(counts.update).toBe(before.update + 1);
    expect(counts.appearance).toBe(before.appearance);
    expect(counts.tier3).toBe(before.tier3);

    const afterSwitch = { ...counts };
    // 「展开更新通道」是 UpdateSection 的局部状态：点击后仍只重渲染它自己
    fireEvent.click(screen.getByText('下载通道'));
    expect(counts.update).toBe(afterSwitch.update + 1);
    expect(counts.appearance).toBe(afterSwitch.appearance);
    expect(counts.tier3).toBe(afterSwitch.tier3);
  });

  it('页面只做布局：区段按拆段前的顺序排列', async () => {
    await act(async () => {
      render(<SettingsPage />);
    });
    const text = document.body.textContent ?? '';
    // 顺序即拆段前 settings.tsx 的区段顺序（视觉零变化的一部分）
    const labels = ['外观', '播放', '直连状态', '第三方解析源（tier3）', '播放诊断', '缓存管理', '关于'];
    let last = -1;
    for (const label of labels) {
      const at = text.indexOf(label);
      expect(at, label).toBeGreaterThan(last);
      last = at;
    }
  });
});
