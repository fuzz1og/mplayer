import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Song } from '@mplayer/core';

/**
 * 正在播放（.proto/now-playing.png · ALIGN.md §3）：顶栏/左列/右列/底栏四段的骨架语义与几何契约。
 * 两个 store 保持真实实现（要验的就是订阅链路）；传输层与歌单弹层降为桩。
 */

const audioPlayerMock = vi.hoisted(() => {
  const player = {
    getVolume: vi.fn(() => 80), getPosition: vi.fn(() => 102), getDuration: vi.fn(() => 269),
    getState: vi.fn(() => 'playing'), getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => true), isPaused: vi.fn(() => false), isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(), load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(),
    stop: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), destroy: vi.fn(),
  };
  return { player };
});

vi.mock('@/renderer/services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: vi.fn(async () => undefined) }));
vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn(async () => []) },
}));
vi.mock('@/renderer/utils/songCoverRefresh', () => ({ refreshSongCover: vi.fn(async () => null) }));
// 加入歌单弹层自有用例：本页只验「入口能否打开它」
vi.mock('@/renderer/components/AddToPlaylistModal', () => ({
  default: ({ isVisible }: { isVisible: boolean }) => (isVisible ? <div data-testid="add-modal" /> : null),
}));

import LyricsPage, { ambientGlowStyle } from '@/renderer/pages/LyricsPage';
import { IpcClient } from '@/renderer/services/IpcClient';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { playbackClock } from '@/renderer/services/playbackClock';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const playerCss = readFileSync(join(testDir, '..', 'styles', 'player.css'), 'utf8');

function song(id: string, name: string, artist: string, album = ''): Song {
  return {
    id, name, artist, album, duration: 269, sourceType: 'netease',
    url: `https://audio.example.com/${id}.mp3`, cover: `https://cover.example.com/${id}.jpg`, lrc: '',
  } as Song;
}

const CURRENT = song('n1', '晴天', '周杰伦', '叶惠美');
const LRC = [
  '[00:00.00]故事的小黄花',
  '[00:04.00]从出生那年就飘着',
  '[01:40.00]吹着前奏望着天空',
  '[02:00.00]我想起花瓣试着掉落',
].join('\n');

function seed() {
  usePlayerStore.setState({
    currentSong: CURRENT,
    isPlaying: true,
    isLoading: false,
    volume: 70,
    playMode: '列表循环',
    lyrics: LRC,
    lyricsLoading: false,
    currentPlaylist: [CURRENT, song('n2', '后来', '刘若英', '我等你'), song('n3', '起风了', '买辣椒也用券')],
    currentPlaylistIndex: 0,
    shuffle: null,
  });
  useFavoriteStore.setState({ favoriteIds: [], favorites: [], loading: false, error: null });
}

/** 从 CSS 里切出某个选择器块的正文（只用于验几何契约，不做样式引擎的事） */
function cssBlock(selector: string): string {
  const start = playerCss.indexOf(selector + ' {');
  if (start === -1) return '';
  const body = playerCss.slice(start);
  const end = body.indexOf('\n}');
  return end === -1 ? body : body.slice(0, end);
}

describe('正在播放 overlay（原型 §3）', () => {
  beforeEach(() => {
    localStorage.clear();
    playbackClock.destroy();
    playbackClock.connect(() => 102);
    playbackClock.setDuration(269);
    playbackClock.setPosition(102);
    vi.mocked(IpcClient.invoke).mockReset();
    vi.mocked(IpcClient.invoke).mockResolvedValue([]);
    seed();
  });

  it('页面不再自带顶栏：收起与「正在播放」身份交给全局标题栏，页面只留「…」', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '收起播放器' })).toBeNull();
    expect(screen.queryByText('正在播放')).toBeNull();
    expect(document.querySelector('.lyrics-page__topbar')).toBeNull();
    expect(document.querySelector('.lyrics-page')).toHaveAttribute('data-now-playing');
    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
  });

  it('「…」菜单里是 收藏 / 加入歌单 / 下载，点加入歌单打开弹层', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('menuitem', { name: '收藏' })).toBeInTheDocument();
    expect(screen.queryByTestId('add-modal')).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: '加入歌单' }));
    expect(screen.getByTestId('add-modal')).toBeInTheDocument();
    // 选完动作菜单自动收起
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('收藏菜单项走真实 favoriteStore（aria-pressed 翻转）', async () => {
    render(<LyricsPage onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const item = screen.getByRole('menuitem', { name: '收藏' });
    expect(item).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(item);
    // toggleFavorite 是异步 IPC：等 store 落定
    await waitFor(() => expect(useFavoriteStore.getState().favoriteIds).toContain('n1'));
  });

  it('ESC 收起本页；菜单开着时 ESC 先收菜单（不关层）', () => {
    const onBack = vi.fn();
    render(<LyricsPage onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('环境光：cover:getAccent 返回真实主色 → --np-glow-* 写成 hsl(hue …)', async () => {
    vi.mocked(IpcClient.invoke).mockImplementation(async (channel) => {
      if (channel === 'cover:getAccent') return { hue: 120, saturation: 0.6, lightness: 0.35 };
      return [];
    });

    render(<LyricsPage onBack={vi.fn()} />);
    const ambient = document.querySelector('.lyrics-page__ambient') as HTMLElement;

    await waitFor(() => expect(ambient.getAttribute('style') ?? '').toContain('hsl(120'));
    expect(IpcClient.invoke).toHaveBeenCalledWith('cover:getAccent', CURRENT.cover);
    const style = ambient.getAttribute('style') ?? '';
    expect(style).toContain('--np-glow-a');
    expect(style).toContain('--np-glow-b');
    // 主题约束：浅色 L62 / A0.18，色相取封面（DECISIONS §9）
    expect(style).toContain('hsl(120 42% 62% / 0.18)');
  });

  it('环境光主题约束：暗色 L26 / A0.55，浅色 L62 / A0.18（色相仍取封面）', () => {
    const dark = ambientGlowStyle({ hue: 238, saturation: 0.8, lightness: 0.5 }, true);
    expect(dark['--np-glow-a']).toBe('hsl(238 42% 26% / 0.55)' as never);
    const light = ambientGlowStyle({ hue: 238, saturation: 0.8, lightness: 0.5 }, false);
    expect(light['--np-glow-a']).toBe('hsl(238 42% 62% / 0.18)' as never);
    expect(ambientGlowStyle(null, false)).toEqual({});
  });

  it('环境光：无封面时不请求取色，style 为空', () => {
    usePlayerStore.setState({ currentSong: { ...CURRENT, cover: '' } });

    render(<LyricsPage onBack={vi.fn()} />);
    const ambient = document.querySelector('.lyrics-page__ambient') as HTMLElement;

    expect(IpcClient.invoke).not.toHaveBeenCalledWith('cover:getAccent', expect.anything());
    expect(ambient.getAttribute('style') ?? '').not.toContain('--np-glow');
  });

  it('环境光：接口返回 null（无 API/取不到色）时 style 为空', async () => {
    vi.mocked(IpcClient.invoke).mockResolvedValue(null);

    render(<LyricsPage onBack={vi.fn()} />);
    const ambient = document.querySelector('.lyrics-page__ambient') as HTMLElement;

    await waitFor(() => expect(IpcClient.invoke).toHaveBeenCalledWith('cover:getAccent', CURRENT.cover));
    expect(ambient.getAttribute('style') ?? '').not.toContain('--np-glow');
  });

  it('环境光：取色失败（IPC reject）时 style 为空，页面正常渲染', async () => {
    vi.mocked(IpcClient.invoke).mockRejectedValue(new Error('IPC 不可用'));

    render(<LyricsPage onBack={vi.fn()} />);
    const ambient = document.querySelector('.lyrics-page__ambient') as HTMLElement;

    await waitFor(() => expect(IpcClient.invoke).toHaveBeenCalledWith('cover:getAccent', CURRENT.cover));
    expect(ambient.getAttribute('style') ?? '').not.toContain('--np-glow');
    expect(screen.getByRole('heading', { level: 1, name: '晴天' })).toBeInTheDocument();
  });

  it('左列：大封面 + 歌名 + 艺术家含专辑', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    const cover = document.querySelector('.lyrics-page__cover img') as HTMLImageElement;
    expect(cover).toBeTruthy();
    expect(cover.alt).toBe('晴天');
    expect(screen.getByRole('heading', { level: 1, name: '晴天' })).toBeInTheDocument();
    expect(screen.getByText('周杰伦 · 叶惠美')).toBeInTheDocument();
  });

  it('控件行复用 PlayerControls（播放模式/上一/播放|暂停/下一）', () => {
    const { rerender } = render(<LyricsPage onBack={vi.fn()} />);
    for (const name of ['播放模式：列表循环', '上一首', '暂停', '下一首']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // 随机与单曲循环已合并成一个模式键，不再并排两个按钮
    expect(screen.queryByRole('button', { name: '随机播放' })).toBeNull();
    expect(screen.queryByRole('button', { name: '单曲循环' })).toBeNull();
    expect(document.querySelector('.lyrics-page__controls .player-controls')).toBeTruthy();

    act(() => usePlayerStore.setState({ isPlaying: false }));
    rerender(<LyricsPage onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('点暂停真的落到传输层并翻转 store', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(audioPlayerMock.player.pause).toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('单一播放模式键按 列表循环 → 随机播放 → 单曲循环 循环', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    const modeButton = () => screen.getByRole('button', { name: /^播放模式：/ });
    expect(modeButton()).toHaveAttribute('aria-label', '播放模式：列表循环');
    expect(modeButton()).not.toHaveAttribute('aria-pressed');

    fireEvent.click(modeButton());
    expect(usePlayerStore.getState().playMode).toBe('随机播放');
    expect(modeButton()).toHaveAttribute('aria-label', '播放模式：随机播放');

    fireEvent.click(modeButton());
    expect(usePlayerStore.getState().playMode).toBe('单曲循环');
    expect(modeButton()).toHaveAttribute('aria-label', '播放模式：单曲循环');

    fireEvent.click(modeButton());
    expect(usePlayerStore.getState().playMode).toBe('列表循环');
    expect(modeButton()).toHaveAttribute('aria-label', '播放模式：列表循环');
  });

  it('进度行按原型制式显示 1:42 / 4:29（分钟不补零）', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    expect(screen.getByText('1:42')).toBeInTheDocument();
    expect(screen.getByText('4:29')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '播放进度' })).toHaveAttribute('aria-valuenow', '102');
  });

  it('点歌词行 seek 到该行时间（歌词是播放器的可操作面）', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('故事的小黄花'));
    expect(audioPlayerMock.player.seek).toHaveBeenCalledWith(0);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('当前歌词行高亮：data-active 落在 1:42 那一行', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    const active = document.querySelector('.lyrics-page__lyrics .lyrics__line[data-active]');
    expect(active?.textContent).toBe('吹着前奏望着天空');
  });

  it('底栏：左「自动混音 · 标准」，右 歌词/队列/详情 分段 + 音量滑杆', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    expect(screen.getByText('自动混音 · 标准')).toBeInTheDocument();
    for (const label of ['歌词', '队列', '详情']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: '歌词' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('slider', { name: '音量' })).toBeInTheDocument();
  });

  it('队列视图显示 currentPlaylist，当前曲高亮，点其它行走 play', () => {
    const playSpy = vi.fn();
    usePlayerStore.setState({ play: playSpy });
    render(<LyricsPage onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: '队列' }));
    const rows = Array.from(document.querySelectorAll('.np-queue__row')) as HTMLElement[];
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('晴天') as never,
      expect.stringContaining('后来') as never,
      expect.stringContaining('起风了') as never,
    ]);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[1]).not.toHaveAttribute('aria-current');

    fireEvent.click(rows[1]);
    expect(playSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'n2' }));
    // 队列里点歌不打断 overlay：视图仍停在队列
    expect(screen.getByRole('radio', { name: '队列' })).toHaveAttribute('aria-checked', 'true');
  });

  it('随机模式下队列显示随机序（与队列页同一份真相）', () => {
    usePlayerStore.setState({ playMode: '随机播放', shuffle: { order: ['n3', 'n1', 'n2'], cursor: 1 } });
    render(<LyricsPage onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '队列' }));
    const names = Array.from(document.querySelectorAll('.np-queue__name')).map((n) => n.textContent);
    expect(names).toEqual(['起风了', '晴天', '后来']);
  });

  it('详情视图列出 歌名/歌手/专辑/来源/时长/音质', () => {
    render(<LyricsPage onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: '详情' }));
    const labels = Array.from(document.querySelectorAll('.np-detail__label')).map((l) => l.textContent);
    expect(labels).toEqual(['歌名', '歌手', '专辑', '来源', '时长', '音质']);
    const values = Array.from(document.querySelectorAll('.np-detail__value')).map((v) => v.textContent);
    expect(values).toEqual(['晴天', '周杰伦', '叶惠美', '网易云', '4:29', '标准']);
  });

  it('没有在播歌曲：空态 + 返回按钮，不渲染顶栏控件', () => {
    usePlayerStore.setState({ currentSong: null });
    render(<LyricsPage onBack={vi.fn()} />);
    expect(screen.getByText('暂无播放中的歌曲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(screen.queryByText('正在播放')).toBeNull();
  });

  it('几何契约：标题栏之下的内容区（非 fixed）+ 双列 clamp + 56 footer + 不透明底', () => {
    const page = cssBlock('.lyrics-page');
    expect(page).not.toMatch(/position:\s*fixed/);
    expect(page).toMatch(/position:\s*relative/);
    expect(page).toMatch(/flex:\s*1/);
    expect(page).toMatch(/--np-footer-height:\s*56px/);
    expect(page).toMatch(/background:\s*var\(--surface-content\)/);
    expect(page).not.toMatch(/background:\s*transparent/);

    const body = cssBlock('.lyrics-page__body');
    expect(body).toMatch(/grid-template-columns:\s*clamp\(380px, 40%, 460px\) 1fr/);
    expect(body).toMatch(/gap:\s*48px/);
    expect(cssBlock('.lyrics-page__footer')).toMatch(/height:\s*var\(--np-footer-height\)/);
    // 歌词走偏好 token（设置·外观的歌词字号档位对它生效）
    expect(playerCss).toMatch(/font-size:\s*var\(--lyrics-font-size\)/);
    expect(playerCss).toMatch(/line-height:\s*var\(--lyrics-line-height\)/);
  });
});
