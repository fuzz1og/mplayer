// @vitest-environment jsdom
import { Profiler, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 设置页拆段（#425）区段级测试。
 *
 * 环境说明：mobile 的 vitest 是 node env（`docs/agents/testing.md`：setup 只 mock AsyncStorage），
 * 本文件用 `@vitest-environment jsdom` 覆盖，并在**本文件内**把 `react-native` mock 成
 * `react-native-web`——全局 config 不做这个替换，既有 RN 导入在 node env 下仍会响亮失败。
 * 其余 native 专有模块（图标 / expo-constants / 服务层）同样只在本文件 mock。
 *
 * 覆盖两件事：
 * 1. 每个区段能**独立挂载**（不炸、渲染出自己的内容）；
 * 2. **区段内状态不外溢**——某区段的局部状态（tier3 输入、下载通道展开/切换）变化时，
 *    其它区段不重渲染。
 *
 * 注意主题**不在**第 2 条之列：深浅真翻转时 `useTheme` 的 context value 变化，页面与
 * 全部区段都会重渲染（与拆段前一致）——见下方如实断言，不要把它当成隔离点。
 */

// 全局 config 不做 RN→web 别名（那会把既有 RN 导入静默降级成 web 行为）；
// 需要真实渲染 UI 的只此一处，替换收窄到本文件的模块 mock。
// 用 vi.importActual 而非 import()：react-native-web 不随包提供类型声明，
// import() 会让 tsc 报 TS7016，而 importActual 只吃字符串、不参与模块解析。
vi.mock('react-native', () => vi.importActual('react-native-web'));

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
import DeveloperModeSection from '../components/settings/DeveloperModeSection';
import DiagnosticsSection from '../components/settings/DiagnosticsSection';
import CacheSection from '../components/settings/CacheSection';
import AboutSection from '../components/settings/AboutSection';
import UpdateSection from '../components/settings/UpdateSection';
import SettingsPage from '../app/settings';
import { ThemeProvider } from '../theme/ThemeProvider';
import { useSettingsStyles } from '../components/settings/settingsStyles';

/** 各区段 + 一段「挂载后必然出现」的自身文案（证明真的渲染了，不只是没抛异常） */
const SECTIONS: { name: string; node: ReactNode; text: string }[] = [
  { name: 'AppearanceSection', node: <AppearanceSection />, text: '跟随系统' },
  { name: 'PlaybackSection', node: <PlaybackSection />, text: '失败即跳' },
  { name: 'DirectStatusSection', node: <DirectStatusSection />, text: '直连状态' },
  { name: 'Tier3Section', node: <Tier3Section />, text: '添加 URL 订阅' },
  { name: 'DeveloperModeSection', node: <DeveloperModeSection />, text: '开发者模式' },
  { name: 'DiagnosticsSection', node: <DiagnosticsSection />, text: '暂无播放诊断记录。播放一首歌后回到这里查看解析链。' },
  { name: 'CacheSection', node: <CacheSection />, text: '清理缓存' },
  { name: 'AboutSection', node: <AboutSection />, text: '当前版本' },
  { name: 'UpdateSection', node: <UpdateSection />, text: '下载通道' },
];

beforeEach(() => {
  useSettingsStore.setState({ themeMode: 'system', updateChannel: 'auto', tier3Enabled: false, tier3Subscriptions: [], autoSkipOnError: true, devMode: false });
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

  it('主题真实翻转（浅→深）会重渲染全部区段——与拆段前一致，不是本票的隔离点', () => {
    // 8 个区段都经 useSettingsStyles → useTheme 消费主题 context（见 components/settings/*）：
    // 深浅真翻转时 context value（colors 引用）变化，React 让所有消费者重渲染——包括
    // 完全没订阅 themeMode 的 tier3 / 更新 / 缓存 / 诊断。用同一个 hook 做渲染计数探针
    // （Profiler 不统计「仅 context 传播」的子孙更新，用它断言会假绿，故用普通渲染计数）。
    let renders = 0;
    const StyleConsumerProbe = () => {
      useSettingsStyles();
      renders += 1;
      return null;
    };

    // 先钉到浅色再翻深色：不依赖 jsdom 里的系统 scheme，避免「翻了但深浅没变」的假路径
    act(() => {
      useSettingsStore.getState().setThemeMode('light');
    });
    render(
      <ThemeProvider>
        <StyleConsumerProbe />
      </ThemeProvider>,
    );
    const before = renders;

    act(() => {
      useSettingsStore.getState().setThemeMode('dark');
    });

    expect(renders).toBeGreaterThan(before);
  });

  // 下面两条测的是**区段内局部状态**（与主题 context 无关），保留有效断言。
  it('tier3 输入框打字只重渲染 tier3 区段', () => {
    const counts: Record<string, number> = {};
    const track = (id: string, node: ReactNode) => (
      <Profiler id={id} onRender={() => { counts[id] = (counts[id] ?? 0) + 1; }}>
        {node}
      </Profiler>
    );
    render(
      <ThemeProvider>
        {track('appearance', <AppearanceSection />)}
        {track('tier3', <Tier3Section />)}
        {track('about', <AboutSection />)}
      </ThemeProvider>,
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
      <ThemeProvider>
        {track('appearance', <AppearanceSection />)}
        {track('tier3', <Tier3Section />)}
        {track('update', <UpdateSection />)}
      </ThemeProvider>,
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
      render(
        <ThemeProvider>
          <SettingsPage />
        </ThemeProvider>,
      );
    });
    const text = document.body.textContent ?? '';
    // 顺序即 settings.tsx 的区段顺序（#477 在 tier3 之后插了「开发者选项」，诊断区随开关显隐）
    const labels = ['外观', '播放', '直连状态', '第三方解析源（tier3）', '开发者选项', '缓存管理', '关于'];
    let last = -1;
    for (const label of labels) {
      const at = text.indexOf(label);
      expect(at, label).toBeGreaterThan(last);
      last = at;
    }
  });
});

describe('开发者模式开关（#477）：诊断区默认不出现', () => {
  const DIAG_EMPTY = '暂无播放诊断记录。播放一首歌后回到这里查看解析链。';
  const LOG_EMPTY = '暂无日志记录。';
  const TOGGLE_LABEL = '开发者模式';

  const mountPage = async () => {
    await act(async () => {
      render(
        <ThemeProvider>
          <SettingsPage />
        </ThemeProvider>,
      );
    });
    return document.body.textContent ?? '';
  };

  it('关（默认）：开关常驻可见，诊断区不渲染', async () => {
    await mountPage();

    // 开关本身必须可见——若开关也藏在开关后面，用户永远打不开
    expect(screen.getAllByText(TOGGLE_LABEL).length).toBeGreaterThan(0);
    expect(screen.queryByText(DIAG_EMPTY)).toBeNull();
    expect(screen.queryByText(LOG_EMPTY)).toBeNull();
  });

  it('开：同一个页面重渲染后诊断区出现（日志查看器 + trace 列表）', async () => {
    await mountPage();
    expect(screen.queryByText(DIAG_EMPTY)).toBeNull();

    act(() => {
      useSettingsStore.getState().setDevMode(true);
    });

    expect(screen.getByText(DIAG_EMPTY)).toBeTruthy();
    expect(screen.getByText(LOG_EMPTY)).toBeTruthy();
  });
});
