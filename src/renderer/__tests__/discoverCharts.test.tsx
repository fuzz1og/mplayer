import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TOPLIST_SOURCE_IDS } from '@mplayer/core';
import type { Song, ToplistGroup, ToplistSourceKey } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import DiscoverPageV2 from '@/renderer/pages/DiscoverPageV2';
import ChartPanel, { CHART_PREVIEW_ROWS } from '@/renderer/components/ChartPanel';
import { useSearchStore } from '@/renderer/store/searchStore';
import { usePlayerStore } from '@/renderer/store/playerStore';

const audioPlayerMock = vi.hoisted(() => {
  const player = {
    getVolume: vi.fn(() => 80), getPosition: vi.fn(() => 0), getDuration: vi.fn(() => 0),
    getState: vi.fn(() => 'idle'), getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => false), isPaused: vi.fn(() => false), isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(), load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(),
    stop: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), destroy: vi.fn(),
  };
  return { player };
});

const callMusicApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn(async () => ({ success: true, data: undefined })) },
}));

vi.mock('@/renderer/services/callMusicApi', () => ({
  callMusicApi: callMusicApiMock,
}));

function song(sourceType: Song['sourceType'], id: string, name: string, rankMeta?: Song['rankMeta']): Song {
  return { id, name, artist: '歌手', album: '', duration: 200, sourceType, url: '', cover: '', lrc: '', ...(rankMeta ? { rankMeta } : {}) };
}

/** 各榜曲目数：默认两个榜都短，列对齐测试里再把新歌榜拉长 */
let hotCount = 2;
let newCount = 3;

/** 单源 getToplists 结果：热歌/新歌各一组，id 用 core 契约值（消费方按 id 取组） */
function groupsFor(source: ToplistSourceKey): ToplistGroup[] {
  const ids = TOPLIST_SOURCE_IDS[source];
  const extra = source === 'qq' ? ({ prevRank: 5, weeks: 3 } as const) : undefined;
  const songs = (kind: 'h' | 'n', count: number) =>
    Array.from({ length: count }, (_, i) => song(source, `${source}-${kind}-${i}`, `${source} ${kind === 'h' ? '热歌' : '新歌'} ${i + 1}`, extra));
  return [
    { id: `${source}:${ids.hot}`, name: '热歌榜', songs: songs('h', hotCount) },
    { id: `${source}:${ids.new}`, name: '新歌榜', songs: songs('n', newCount) },
  ];
}

/** 歌名只在行标题里比（行内的换源弹层也带歌名，纯文本查询会撞上） */
const findTitle = (name: string) => screen.findByText(name, { selector: '.song-row__title' });
const queryTitle = (name: string) => screen.queryByText(name, { selector: '.song-row__title' });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPageV2 />} />
        <Route path="/hotlist/:type" element={<div data-testid="hotlist-detail">榜单详情</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('发现页 V2 排行榜（#332 单元榜 + 源切换）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    hotCount = 2;
    newCount = 3;
    callMusicApiMock.mockReset();
    callMusicApiMock.mockImplementation(async (method: string, source: ToplistSourceKey) =>
      method === 'getToplists' ? groupsFor(source) : undefined
    );
    useSearchStore.setState({ currentKeyword: '', preferredTab: 'songs', sourceType: 'all', songs: [], groups: [], loading: false, hasMore: false, error: null });
    usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null, isPlaying: false, isLoading: false });
    vi.mocked(IpcClient.invoke).mockClear();
  });

  it('切源取该源榜单；列标题只有榜单名（来源已由页面 segmented 选过）；切回缓存不串榜', async () => {
    renderPage();

    expect(await findTitle('netease 热歌 1')).toBeInTheDocument();
    expect(await findTitle('netease 新歌 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '热歌榜' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '新歌榜' })).toBeInTheDocument();
    // 「网易云 · 热歌榜」这类来源前缀不再出现
    expect(screen.queryByText('网易云 · 热歌榜')).toBeNull();

    // 切 QQ：换成 QQ 榜单；名次变化/在榜周数这类元信息已随「行内信息收敛」下线
    fireEvent.click(screen.getByRole('button', { name: 'QQ音乐' }));
    expect(await findTitle('qq 热歌 1')).toBeInTheDocument();
    expect(queryTitle('netease 热歌 1')).toBeNull();
    expect(screen.queryByText('↑4')).toBeNull();
    expect(screen.queryByText(/在榜 3 周/)).toBeNull();

    // 切回网易云：命中未过期缓存也必须把该源榜单铺回状态（曾出现沿用 QQ 曲目）
    fireEvent.click(screen.getByRole('button', { name: '网易云' }));
    expect(await findTitle('netease 热歌 1')).toBeInTheDocument();
    expect(queryTitle('qq 热歌 1')).toBeNull();

    // 缓存命中不重复请求：netease 首次 + qq 切换 = 2 次
    const calls = callMusicApiMock.mock.calls.filter((c) => c[0] === 'getToplists');
    expect(calls).toHaveLength(2);
  });

  it('两列在发现的同一个滚动上下文里：只有一个 [data-scroll-container]，列内没有滚动容器', async () => {
    const { container } = renderPage();
    await findTitle('netease 热歌 1');

    // 与推荐页/资料库同一口径：外层页流滚动，列只是流里的两栏
    expect(container.querySelectorAll('[data-scroll-container]')).toHaveLength(1);
    expect(container.querySelector('.discover-charts')).not.toBeNull();
    expect(container.querySelectorAll('.chart')).toHaveLength(2);
    // 旧实现的双列内部滚动容器已删除
    expect(container.querySelectorAll('.chart__scroll')).toHaveLength(0);
  });

  it('列标题带「更新于 HH:mm」lead', async () => {
    renderPage();
    await findTitle('netease 热歌 1');

    expect(screen.getAllByText(/^更新于 \d{2}:\d{2}$/)).toHaveLength(2);
    expect(containerTitles()).toEqual(['热歌榜', '新歌榜']);
  });

  it('列对齐：两列取较小行数渲染，长的一列在列底给「查看全部 N 首」并跳对应榜单详情', async () => {
    hotCount = 3;
    newCount = CHART_PREVIEW_ROWS + 2;
    const { container } = renderPage();
    await findTitle('netease 热歌 1');

    const panels = Array.from(container.querySelectorAll('.chart')) as HTMLElement[];
    expect(panels).toHaveLength(2);
    // 两列行数相等 = 较小者（热歌 3 首）
    expect(within(panels[0]).getAllByRole('button', { name: /更多操作:/ })).toHaveLength(3);
    expect(within(panels[1]).getAllByRole('button', { name: /更多操作:/ })).toHaveLength(3);
    // 短的一列没有「查看全部」；长的一列有，且数字是全榜曲目数
    expect(within(panels[0]).queryByRole('button', { name: /查看全部/ })).toBeNull();
    fireEvent.click(within(panels[1]).getByRole('button', { name: `查看全部 ${newCount} 首` }));
    expect(await screen.findByTestId('hotlist-detail')).toBeInTheDocument();
  });

  it('两列行都是 46px 资料库密度行：骨架与最终形态同行高、同序号列宽', async () => {
    const { container } = renderPage();
    await findTitle('netease 热歌 1');

    const rows = Array.from(container.querySelectorAll('.chart .song-row')) as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.style.getPropertyValue('--song-row-height')).toBe('46px');
      expect(row.style.getPropertyValue('--song-row-cover')).toBe('30px');
    }
    const indexCell = rows[0].querySelector('.song-row__index') as HTMLElement;
    expect(indexCell.style.getPropertyValue('--col-width')).toBe('24px');

    // 骨架：同一行数与密度，加载前后不跳高
    const skeleton = render(
      <MemoryRouter>
        <ChartPanel title="热歌榜" chartId="hot" songs={[]} loading error={null} onPlay={vi.fn()} isCurrentSong={() => false} />
      </MemoryRouter>
    );
    const skeletonRows = Array.from(skeleton.container.querySelectorAll('.song-skeleton__row')) as HTMLElement[];
    expect(skeletonRows).toHaveLength(CHART_PREVIEW_ROWS);
    for (const row of skeletonRows) expect(row.style.getPropertyValue('--song-row-height')).toBe('46px');
  });

  it('榜单行点播：回传歌曲 + 整榜队列 + 行下标，列表不隐式写播放队列（D2）', () => {
    const songs = [
      song('qq', 'qq-1', '榜单一'),
      song('qq', 'qq-2', '榜单二'),
      song('qq', 'qq-3', '榜单三'),
    ];
    const onPlay = vi.fn();
    usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1 });
    const { container } = render(
      <MemoryRouter>
        <ChartPanel
          title="热歌榜"
          chartId="hot"
          songs={songs}
          loading={false}
          error={null}
          onPlay={onPlay}
          isCurrentSong={() => false}
        />
      </MemoryRouter>
    );

    const rows = Array.from(container.querySelectorAll('.song-row')) as HTMLElement[];
    fireEvent.click(rows[1].querySelector('.song-row__cover-play') as HTMLElement);

    // 整榜入队 + 索引指向点击行：play() 末尾的 prefetchNextUrl 才有「下一首」可预取
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(songs[1], songs, 1, 'hot');
    expect(usePlayerStore.getState().currentPlaylist).toEqual([]);
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(-1);
  });
});

function containerTitles(): string[] {
  return Array.from(document.querySelectorAll('.chart__title')).map((el) => el.textContent ?? '');
}
