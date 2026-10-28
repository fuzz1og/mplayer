import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SettingsPage from '@/renderer/pages/SettingsPage';
import { ToastProvider } from '@/renderer/ui';

/** 主进程替身：容量配置可变，setLimitMb / setAutoClean 写回同一份 state（等价 db 持久化）。 */
const state = {
  limitMb: 100,
  autoClean: true,
};

const cacheStats = {
  totalSize: 52 * 1024 * 1024,
  fileCount: 120,
  songsCount: 40,
  coversCount: 50,
  audioCount: 20,
  urlsCount: 10,
  bytes: { songs: 1048576, urls: 2097152, covers: 20971520, audio: 31457280, other: 0 },
};

/** 单个用例可临时替换统计快照（如空缓存下的禁用态）。 */
let statsOverride: typeof cacheStats | null = null;

const invoke = vi.fn((channel: string, value?: unknown) => {
  if (channel === 'cache:getStats') return Promise.resolve(statsOverride ?? cacheStats);
  if (channel === 'cache:getConfig') {
    return Promise.resolve({ ...state, dir: 'C:/AppData/MPlayer/cache', stepMb: 20, minMb: 20, maxMb: 4096 });
  }
  if (channel === 'cache:setLimitMb') {
    state.limitMb = Number(value);
    return Promise.resolve(state.limitMb);
  }
  if (channel === 'cache:setAutoClean') {
    state.autoClean = value === true;
    return Promise.resolve(state.autoClean);
  }
  if (channel === 'cache:clearKind') return Promise.resolve(true);
  return Promise.resolve(undefined);
});

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: (channel: string, ...args: unknown[]) => invoke(channel, ...args) },
}));

const devModeState = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/renderer/services/devMode', () => ({
  isDevMode: () => devModeState.enabled,
  subscribeDevMode: () => () => undefined,
}));

vi.mock('@/renderer/theme/ThemeManager', () => ({
  useThemeMode: () => ({ mode: 'system', isDark: false, setMode: vi.fn() }),
}));

// 外观页「预览」读播放 store：给一个纯选择器，避免把音频传输层拖进用例
const playerState = { currentSong: null, isPlaying: false };
vi.mock('@/renderer/store/playerStore', () => ({
  usePlayerStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ ...playerState, play: vi.fn(), togglePlay: vi.fn() }),
}));

const navBar = () => within(screen.getByRole('navigation', { name: '设置导航' }));
const body = () => within(screen.getByRole('region', { name: '设置内容' }));

/** SettingsPage 用 useParams 读深链分区，必须在匹配了 /settings/:section 的 Router 里渲染。 */
const renderPage = (path = '/settings') => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>,
);

describe('设置页（1.9.0 原型 §2）', () => {
  beforeEach(() => {
    invoke.mockClear();
    state.limitMb = 100;
    state.autoClean = true;
    statsOverride = null;
    devModeState.enabled = false;
    localStorage.clear();
    // electronAPI 的默认桩返回 {success:true}，下载目录必须是字符串
    const api = (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } }).electronAPI;
    api.invoke.mockResolvedValue('D:/Downloads');
  });

  it('五个分组承载全部设置页（更新/关于并入「关于与更新」）', () => {
    renderPage();
    expect(
      Array.from(document.querySelectorAll('.settings-nav__group-title')).map((el) => el.textContent),
    ).toEqual(['音频与播放', '外观', '存储与下载', '网络与来源', '关于与更新']);

    expect(
      navBar().getAllByRole('button').map((el) => el.textContent?.trim()),
    ).toEqual(['播放', '外观', '缓存', '下载', '直连状态', '第三方解析源', '网络', '更新', '关于']);

    // 旧底栏已并入分组：不再有独立 footer，更新/关于是同组页面项
    expect(document.querySelector('.settings-nav__footer')).toBeNull();
  });

  it('每个设置页有且只有一个一级标题（旧页头统一）', async () => {
    const pages: Array<[string, string]> = [
      ['playback', '播放'],
      ['appearance', '外观'],
      ['cache', '缓存'],
      ['download', '下载'],
      ['source', '直连状态'],
      ['tier3', '第三方解析源'],
      ['network', '网络'],
      ['update', '更新'],
      ['about', '关于'],
    ];
    const { unmount } = renderPage('/settings/cache');
    for (const [, title] of pages) {
      // 切页走导航项（深链映射另有用例）
      await userEvent.click(navBar().getByRole('button', { name: new RegExp('^' + title) }));
      const headings = await body().findAllByRole('heading', { level: 1 });
      expect(headings, title).toHaveLength(1);
      expect(headings[0].textContent).toBe(title);
    }
    unmount();
  });

  it('默认落在缓存页：大号读数 + 上限/还剩 + 存储/构成/位置', async () => {
    renderPage();
    expect(await body().findByRole('heading', { level: 1, name: '缓存' })).toBeInTheDocument();
    // 分区名与说明都不再常显：左栏已点名，说明改挂 info 浮层
    expect(document.querySelector('.cache-usage__value')?.textContent).toContain('52');
    expect(body().getByText('上限 100 MB · 还剩 48 MB')).toBeInTheDocument();

    expect(body().getByText('存储')).toBeInTheDocument();
    expect(body().getByText('空间上限')).toBeInTheDocument();
    expect(body().getByText('超出上限时自动清理最早条目')).toBeInTheDocument();
    expect(body().getByText('清理全部缓存')).toBeInTheDocument();
    expect(body().getByText('位置')).toBeInTheDocument();
    expect(body().getByText('缓存目录')).toBeInTheDocument();
    expect(body().getByText('C:/AppData/MPlayer/cache')).toBeInTheDocument();
  });

  it('构成三行：数量与字节同报', async () => {
    renderPage();
    await body().findByRole('heading', { level: 1, name: '缓存' });
    const rows = Array.from(document.querySelectorAll('.ui-row')).map((el) => el.textContent);
    // 歌曲索引 = songsCount + urlsCount（JSON 条目统称）
    expect(rows.some((t) => t?.includes('歌曲索引') && t?.includes('50 个') && t?.includes('3 MB'))).toBe(true);
    expect(rows.some((t) => t?.includes('封面图片') && t?.includes('50 个') && t?.includes('20 MB'))).toBe(true);
    expect(rows.some((t) => t?.includes('音频文件') && t?.includes('20 个') && t?.includes('30 MB'))).toBe(true);
    expect(body().getByText('缓存按文件数量统计，超出上限时按写入时间从早到晚清理。')).toBeInTheDocument();
  });

  it('空间上限步进写回主进程并刷新剩余额度', async () => {
    renderPage();
    await body().findByText('空间上限');
    await userEvent.click(screen.getByRole('button', { name: '增加空间上限' }));
    expect(await body().findByText('上限 120 MB · 还剩 68 MB')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('cache:setLimitMb', 120);
  });

  it('自动清理开关写回主进程', async () => {
    renderPage();
    const toggle = await body().findByRole('switch', { name: '超出上限时自动清理最早条目' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('cache:setAutoClean', false));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('清理全部缓存需要二次确认', async () => {
    renderPage();
    await body().findByText('清理全部缓存');
    await userEvent.click(body().getByRole('button', { name: '清理' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/此操作不可恢复/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确定清理' })).toBeInTheDocument();
  });

  it('构成三行提供按类型清理入口，二次确认后调用 cache:clearKind', async () => {
    renderPage();
    await body().findByRole('heading', { level: 1, name: '缓存' });

    expect(body().getByRole('button', { name: '清理歌曲索引' })).toBeEnabled();
    expect(body().getByRole('button', { name: '清理封面图片' })).toBeEnabled();
    expect(body().getByRole('button', { name: '清理音频文件' })).toBeEnabled();

    await userEvent.click(body().getByRole('button', { name: '清理封面图片' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/将释放 20 MB/)).toBeInTheDocument();
    expect(within(dialog).getByText(/仅清理「封面图片」/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '确定清理' }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('cache:clearKind', 'covers'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('没有对应条目时按类型清理按钮禁用', async () => {
    statsOverride = {
      totalSize: 0,
      fileCount: 0,
      songsCount: 0,
      coversCount: 0,
      audioCount: 0,
      urlsCount: 0,
      bytes: { songs: 0, urls: 0, covers: 0, audio: 0, other: 0 },
    };
    renderPage();
    await body().findByRole('heading', { level: 1, name: '缓存' });
    expect(body().getByRole('button', { name: '清理歌曲索引' })).toBeDisabled();
    expect(body().getByRole('button', { name: '清理封面图片' })).toBeDisabled();
    expect(body().getByRole('button', { name: '清理音频文件' })).toBeDisabled();
  });

  it('外观页三组：主题分段用中文 label，同步项只读', async () => {
    renderPage();
    await userEvent.click(navBar().getByRole('button', { name: /^外观/ }));
    expect(await body().findByRole('heading', { level: 1, name: '外观' })).toBeInTheDocument();
    expect(body().getByRole('heading', { level: 1, name: '外观' })).toBeInTheDocument();

    expect(within(body().getByRole('radiogroup', { name: '主题' })).getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true');
    expect(body().getByText('外观与系统同步时，自动跟随 Windows 主题')).toBeInTheDocument();
    expect(body().getByText('已开启')).toBeInTheDocument();
    expect(body().getByText('侧栏与播放栏使用半透明材质')).toBeInTheDocument();
    expect(body().getByText('材质依赖系统模糊效果，关闭后改为不透明表面，性能更稳定。')).toBeInTheDocument();

    expect(body().getByText('文字与动效')).toBeInTheDocument();
    expect(body().getByText('字号')).toBeInTheDocument();
    expect(body().getByText('减弱动态效果')).toBeInTheDocument();
    expect(body().getByText('歌词字号')).toBeInTheDocument();

    expect(body().getByText('预览')).toBeInTheDocument();
    expect(body().getByText('当前没有播放中的歌曲')).toBeInTheDocument();
    expect(body().getByRole('button', { name: '播放' })).toBeDisabled();
  });

  it('外观偏好写 localStorage 与 html[data-*]', async () => {
    renderPage();
    await userEvent.click(navBar().getByRole('button', { name: /^外观/ }));
    await body().findByRole('heading', { level: 1, name: '外观' });

    await userEvent.click(screen.getByRole('radio', { name: '紧凑' }));
    await userEvent.click(screen.getByRole('radio', { name: '大' }));
    await userEvent.click(body().getByRole('switch', { name: '侧栏与播放栏使用半透明材质' }));

    expect(document.documentElement.dataset.density).toBe('compact');
    expect(document.documentElement.dataset.fontScale).toBe('large');
    expect(document.documentElement.dataset.material).toBe('off');
    // 未改动的项也写默认值，global.css 只需覆盖非默认分支
    expect(document.documentElement.dataset.reduceMotion).toBe('off');
    expect(document.documentElement.dataset.lyricsSize).toBe('standard');

    const saved = JSON.parse(localStorage.getItem('mplayer.appearance') ?? '{}');
    expect(saved).toMatchObject({ density: 'compact', fontScale: 'large', material: 'off' });
  });

  it('开发者模式下「关于与更新」组尾出现诊断页，路径可达', async () => {
    devModeState.enabled = true;
    renderPage();
    const diagnostics = navBar().getByRole('button', { name: /^诊断/ });
    expect(diagnostics).toBeInTheDocument();
    await userEvent.click(diagnostics);
    expect(await body().findByRole('heading', { level: 1, name: '诊断' })).toBeInTheDocument();
  });

  it('设置页不再自带返回条', async () => {
    const { container } = renderPage();
    await body().findByRole('heading', { level: 1, name: '缓存' });
    expect(container.querySelector('.settings-shell__bar')).toBeNull();
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
  });

  it('深链 #/settings/appearance 直接落外观页；非法分区回落缓存页', async () => {
    const { unmount } = renderPage('/settings/appearance');
    expect(await body().findByRole('heading', { level: 1, name: '外观' })).toBeInTheDocument();
    expect(navBar().getByRole('button', { name: /^外观/ })).toHaveAttribute('aria-current', 'page');
    unmount();

    renderPage('/settings/nope');
    expect(await body().findByRole('heading', { level: 1, name: '缓存' })).toBeInTheDocument();
  });
});
