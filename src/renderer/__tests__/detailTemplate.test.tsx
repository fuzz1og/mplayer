import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import DetailToolbar from '@/renderer/components/DetailToolbar';
import { SONG_ROW_HEIGHTS, SONG_ROW_COVER_SIZES } from '@/renderer/components/songRowMetrics';

/**
 * #694 详情页模板与歌手列表的**共享口径**：工具条 40 / 行 46 / 内容网格 token。
 * jsdom 没有布局，几何由真实 Electron 断言；这里钉 token 与结构，二者同一个事实源。
 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const stylesDir = join(testDir, '..', 'styles');
const globalCss = readFileSync(join(stylesDir, 'global.css'), 'utf8');
const toolbarCss = readFileSync(join(stylesDir, 'detail-toolbar.css'), 'utf8');
const pageCss = readFileSync(join(stylesDir, 'detail-page.css'), 'utf8');
const songlistCss = readFileSync(join(stylesDir, 'songlist.css'), 'utf8');

const callMusicApi = vi.fn();
vi.mock('@/renderer/services/callMusicApi', () => ({ callMusicApi: (...a: any[]) => callMusicApi(...a) }));
const playerState = { play: vi.fn(), setCurrentPlaylist: vi.fn(), currentSong: null, isPlaying: false };
vi.mock('@/renderer/store/playerStore', () => ({ usePlayerStore: (s: any) => s(playerState) }));
vi.mock('@/renderer/services/playableVersionAdapter', () => ({ resolvePlayableVersionForDesktop: async (s: any) => s }));
vi.mock('@/renderer/services/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ArtistListPage from '@/renderer/pages/ArtistListPage';

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('详情页尺寸 token（#694）', () => {
  it('工具条 40、hero 200 / 歌手圆形 168 只在 token 层登记一次', () => {
    expect(globalCss).toContain('--detail-toolbar-height: 40px;');
    expect(globalCss).toContain('--detail-hero-cover: 200px;');
    expect(globalCss).toContain('--detail-hero-artist: 168px;');
    expect(toolbarCss).toContain('height: var(--detail-toolbar-height);');
    expect(pageCss).toContain('width: var(--detail-hero-cover);');
    expect(pageCss).toContain('width: var(--detail-hero-artist);');
  });

  it('列表行高 46 / 封面 30 来自密度协议，页面不再各写一份', () => {
    expect(SONG_ROW_HEIGHTS.library).toBe(46);
    expect(SONG_ROW_COVER_SIZES.library).toBe(30);
  });

  it('内容网格的列宽下限与间距来自同一组 token', () => {
    expect(globalCss).toContain('--content-grid-min: 132px;');
    expect(globalCss).toContain('--content-grid-col-gap: var(--space-4);');
    for (const rule of [/\.artists__grid \{[^}]*minmax\(var\(--content-grid-min\)/, /\.card-grid \{[^}]*minmax\(var\(--content-grid-min\)/, /\.album-scroll__grid \{[^}]*minmax\(var\(--content-grid-min\)/]) {
      expect(songlistCss).toMatch(rule);
    }
  });
});

describe('DetailToolbar（#694 共享工具条）', () => {
  function renderToolbar(overrides: Record<string, unknown> = {}) {
    const props = {
      filterValue: '',
      onFilterChange: vi.fn(),
      matchedCount: 3,
      totalCount: 10,
      selecting: false,
      onToggleSelecting: vi.fn(),
      onSelectAll: vi.fn(),
      allSelected: false,
      selectedCount: 0,
      batchActions: [],
      ...overrides,
    };
    return render(<DetailToolbar {...(props as any)} />);
  }

  it('一行里放过滤框 + 选择入口；不进入选择模式就没有全选与批量栏', () => {
    const { container } = renderToolbar();
    expect(container.querySelectorAll('[data-detail-toolbar]').length).toBe(1);
    expect(container.querySelector('input[aria-label="按歌名或歌手过滤"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="全选可见歌曲"]')).toBeNull();
    expect(container.querySelector('.detail-toolbar__toggle')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).not.toContain('已选择');
  });

  it('过滤中显示 N / M 首与清空按钮；批量栏原地替换左半段，完成入口仍在', () => {
    const onFilterChange = vi.fn();
    const { container } = renderToolbar({
      filterValue: '晴天',
      onFilterChange,
      matchedCount: 1,
      totalCount: 10,
      selecting: true,
      selectedCount: 2,
      batchActions: [{ key: 'download', label: '批量下载', onClick: vi.fn() }],
    });
    expect(container.textContent).toContain('1 / 10 首');
    fireEvent.click(container.querySelector('.detail-toolbar__filter-clear') as HTMLElement);
    expect(onFilterChange).toHaveBeenCalledWith('');
    expect(container.textContent).toContain('已选择 2 项');
    expect(container.querySelectorAll('.detail-toolbar__batch-btn').length).toBe(1);
    // 批量栏与工具条同处一行：完成入口没有因此被挤掉
    expect(container.querySelector('.detail-toolbar__toggle')?.textContent?.trim()).toBe('完成');
  });

  it('没有批量能力的页面可以只留过滤（selectable=false）', () => {
    const { container } = renderToolbar({ selectable: false });
    expect(container.querySelector('.detail-toolbar__toggle')).toBeNull();
    expect(container.querySelector('input[aria-label="按歌名或歌手过滤"]')).toBeTruthy();
  });
});

describe('歌手列表（#694 内容网格）', () => {
  const ARTISTS = [
    { id: 'ar1', name: '陆行舟', picUrl: '', alias: [], albumSize: 3, musicSize: 42, sourceType: 'netease' },
    { id: 'ar2', name: '林夏', picUrl: '', alias: [], albumSize: 0, musicSize: 0, sourceType: 'netease' },
  ];

  function renderList() {
    callMusicApi.mockReset();
    callMusicApi.mockImplementation(async (method: string) => {
      if (method === 'getArtists') return { artists: ARTISTS, more: false };
      if (method === 'getArtistSongs') return { songs: [{ id: 's1', name: '晴天', artist: '陆行舟', album: '', duration: 200, sourceType: 'netease', url: '', cover: '', lrc: '' }], total: 1 };
      return undefined;
    });
    return render(
      <MemoryRouter initialEntries={['/artists']}>
        <Routes>
          <Route path="/artists" element={<ArtistListPage />} />
          <Route path="/artist/:id" element={<div data-testid="artist-detail" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('圆形媒体 1:1 + 名字 + 按需副行；卡片可聚焦，Enter 进详情', async () => {
    const { container } = renderList();
    await waitFor(() => expect(container.querySelectorAll('.artist-card').length).toBe(2));

    expect(container.querySelectorAll('.artists__grid .artist-card').length).toBe(2);
    expect(container.querySelectorAll('.artist-card__media').length).toBe(2);
    const names = Array.from(container.querySelectorAll('.artist-card__name')).map((el) => el.textContent);
    expect(names).toEqual(['陆行舟', '林夏']);

    // 副行只在拿得到数字时渲染
    const metas = Array.from(container.querySelectorAll('.artist-card__meta')).map((el) => el.textContent);
    expect(metas).toEqual(['42 首']);

    const first = container.querySelector('.artist-card') as HTMLElement;
    expect(first.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(await screen.findByTestId('artist-detail')).toBeTruthy();
  });

  it('hover 换 surface-card-hover，角落播放按钮出现；播放按钮取该歌手热门歌曲', async () => {
    // 显隐由 hover/focus-within 驱动（动画复用通用卡片的透明度过渡）
    expect(songlistCss).toMatch(/\.artist-card:hover,\s*\.artist-card:focus-within \{[^}]*background: var\(--surface-card-hover\);/);
    expect(songlistCss).toMatch(/\.artist-card:hover \.artist-card__play,[\s\S]*?opacity: 1;/);

    const { container } = renderList();
    await waitFor(() => expect(container.querySelectorAll('.artist-card').length).toBe(2));
    const playButton = container.querySelector('.artist-card__play') as HTMLElement;
    expect(playButton.getAttribute('aria-label')).toBe('播放歌手 陆行舟 的热门歌曲');
    fireEvent.click(playButton);
    await waitFor(() => expect(callMusicApi).toHaveBeenCalledWith('getArtistSongs', 'netease', 'ar1', 0, 50, 'hot'));
    expect(playerState.setCurrentPlaylist).toHaveBeenCalled();
  });
});
