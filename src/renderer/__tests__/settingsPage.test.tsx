import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SettingsPage from '@/renderer/pages/SettingsPage';

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

const invoke = vi.fn((channel: string, value?: unknown) => {
  if (channel === 'cache:getStats') return Promise.resolve(cacheStats);
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
  return Promise.resolve(undefined);
});

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: (channel: string, ...args: unknown[]) => invoke(channel, ...args) },
}));

vi.mock('@/renderer/services/devMode', () => ({
  isDevMode: () => false,
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
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/:section" element={<SettingsPage />} />
    </Routes>
  </MemoryRouter>,
);

describe('设置页（1.9.0 原型 §2）', () => {
  beforeEach(() => {
    invoke.mockClear();
    state.limitMb = 100;
    state.autoClean = true;
    localStorage.clear();
  });

  it('3 组 7 页，更新/关于钉在导航底部', () => {
    renderPage();
    expect(
      navBar().getAllByText(/^(通用|资料库|音乐源)$/).map((el) => el.textContent),
    ).toEqual(['通用', '资料库', '音乐源']);

    expect(
      navBar().getAllByRole('button').map((el) => el.textContent?.trim()),
    ).toEqual(['外观', '播放', '缓存', '下载', '直连状态', '第三方解析源', '网络', '更新', '关于']);

    const footer = document.querySelector('.settings-nav__footer');
    expect(footer?.textContent).toContain('更新');
    expect(footer?.textContent).toContain('关于');
    expect(navBar().queryByText('应用')).toBeNull();
  });

  it('默认落在缓存页：大号读数 + 上限/还剩 + 存储/构成/位置', async () => {
    renderPage();
    expect(await body().findByRole('heading', { level: 1, name: '缓存' })).toBeInTheDocument();
    expect(body().getByText('缓存封面、歌词与索引，加快重复浏览')).toBeInTheDocument();
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
    expect(body().getByText('缓存按文件数量统计，超出上限时优先清理最久未访问的条目。')).toBeInTheDocument();
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

  it('外观页三组：主题分段用中文 label，同步项只读', async () => {
    renderPage();
    await userEvent.click(navBar().getByRole('button', { name: /^外观/ }));
    expect(await body().findByRole('heading', { level: 1, name: '外观' })).toBeInTheDocument();
    expect(body().getByText('主题、密度与材质')).toBeInTheDocument();

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
