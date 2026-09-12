import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song, SongGroup } from '@mplayer/core';
import SongList from '@/renderer/components/SongList';
import GroupedSongList from '@/renderer/components/GroupedSongList';

// 用 SongCover 的渲染次数当「这一行是否重渲染」的探针：
// SongRow 是 React.memo，行内封面若没重渲染，说明该行的 props 身份稳定。
const coverRenders = vi.hoisted(() => new Map<string, number>());

vi.mock('@/renderer/components/SongCover', () => ({
  default: ({ alt }: { alt?: string }) => {
    const key = alt ?? '';
    coverRenders.set(key, (coverRenders.get(key) ?? 0) + 1);
    return <div data-testid={`cover-${key}`} />;
  },
}));

function song(index: number): Song {
  return {
    id: `netease:${index}`,
    name: `歌曲 ${index}`,
    artist: '歌手',
    album: '',
    duration: 240,
    sourceType: 'netease',
    url: `https://audio.example.com/${index}.mp3`,
    cover: `https://cover.example.com/${index}.jpg`,
    lrc: '',
  };
}

interface ExtraProps {
  favoriteIds?: string[];
  onToggleFavorite?: (song: Song) => void;
}

function SongListFixture({ songs, favoriteIds, onToggleFavorite }: { songs: Song[] } & ExtraProps) {
  return (
    <MemoryRouter>
      <SongList
        songs={songs}
        onPlay={() => {}}
        showHeader={false}
        favoriteIds={favoriteIds}
        onToggleFavorite={onToggleFavorite}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  coverRenders.clear();
});

describe('歌曲列表模块：行 memo 稳定性', () => {
  it('勾选一行只重渲染该行，兄弟行不动', () => {
    const songs = [1, 2, 3, 4, 5].map(song);
    render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={() => {}} showHeader={false} showCheckbox />
      </MemoryRouter>
    );

    const before = new Map(coverRenders);
    expect(before.size).toBe(songs.length);

    fireEvent.click(screen.getAllByRole('checkbox')[2]);

    for (const s of songs) {
      const expected = (before.get(s.name) ?? 0) + (s.name === '歌曲 3' ? 1 : 0);
      expect(coverRenders.get(s.name)).toBe(expected);
    }
  });

  it('调用方每次新建回调/数组（内容不变）不会击穿行 memo', () => {
    const songs = [1, 2, 3].map(song);
    const { rerender } = render(
      <SongListFixture songs={songs} favoriteIds={['netease:1']} onToggleFavorite={() => {}} />
    );
    const before = new Map(coverRenders);

    // 新的一次渲染：onPlay / onToggleFavorite / favoriteIds 全换新身份，内容不变
    rerender(<SongListFixture songs={songs} favoriteIds={['netease:1']} onToggleFavorite={() => {}} />);

    expect(new Map(coverRenders)).toEqual(before);
  });

  it('打开某行的「更多」菜单只重渲染该行', () => {
    const songs = [1, 2, 3].map(song);
    render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={() => {}} showHeader={false} />
      </MemoryRouter>
    );
    const before = new Map(coverRenders);

    fireEvent.click(screen.getByRole('button', { name: '更多操作: 歌曲 2' }));

    for (const s of songs) {
      const expected = (before.get(s.name) ?? 0) + (s.name === '歌曲 2' ? 1 : 0);
      expect(coverRenders.get(s.name)).toBe(expected);
    }
  });
});

describe('歌曲列表模块：虚拟滚动', () => {
  it('超过阈值的列表只挂窗口内的行，未进入窗口的行不渲染', async () => {
    const songs = Array.from({ length: 200 }, (_, i) => song(i));
    // jsdom 没有布局：给滚动容器造一个 900x600 的视口，@tanstack/react-virtual 才能算出窗口
    const scrollEl = document.createElement('div');
    scrollEl.style.overflowY = 'auto';
    Object.defineProperty(scrollEl, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scrollEl, 'clientWidth', { value: 900, configurable: true });
    // @tanstack/react-virtual 量的是 offsetWidth/offsetHeight，jsdom 里恒为 0
    Object.defineProperty(scrollEl, 'offsetHeight', { value: 600, configurable: true });
    Object.defineProperty(scrollEl, 'offsetWidth', { value: 900, configurable: true });
    scrollEl.getBoundingClientRect = () => ({
      width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(scrollEl);

    render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={() => {}} showHeader={false} />
      </MemoryRouter>,
      { container: scrollEl }
    );

    await waitFor(() => expect(coverRenders.size).toBeGreaterThan(0));
    expect(coverRenders.size).toBeLessThan(40);
    expect(coverRenders.has('歌曲 0')).toBe(true);
    expect(coverRenders.has('歌曲 199')).toBe(false);
  });

  it('短列表整表渲染，不做虚拟化探测', () => {
    const songs = [1, 2, 3].map(song);
    render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={() => {}} showHeader={false} />
      </MemoryRouter>
    );
    expect(coverRenders.size).toBe(3);
  });
});

describe('分组歌曲列表：数据经 props（页面做适配器）', () => {
  const groups: SongGroup[] = [
    { key: 'sunny', name: '晴天', artist: '周杰伦', songs: [song(1), song(2), song(3)] },
    { key: 'rainy', name: '雨天', artist: '孙燕姿', songs: [song(4), song(5)] },
  ];

  const renderGrouped = (overrides: Partial<React.ComponentProps<typeof GroupedSongList>> = {}) => {
    const props = {
      groups,
      expandedKeys: ['sunny'],
      onToggleGroup: vi.fn(),
      onExpandAll: vi.fn(),
      onCollapseAll: vi.fn(),
      onPlay: vi.fn(),
      onToggleFavorite: vi.fn(),
      selectedIds: [],
      onSelectionChange: vi.fn(),
      ...overrides,
    };
    render(
      <MemoryRouter>
        <GroupedSongList {...props} />
      </MemoryRouter>
    );
    return props;
  };

  it('已展开的组渲染组内歌曲，折叠的组只留组头', () => {
    renderGrouped();

    expect(screen.getByText('晴天')).toBeInTheDocument();
    expect(screen.getByText('雨天')).toBeInTheDocument();
    expect(coverRenders.size).toBe(3);
    expect(coverRenders.has('歌曲 4')).toBe(false);
  });

  it('「全部展开 / 全部折叠」把决定权交回适配器', () => {
    const props = renderGrouped({ expandedKeys: [] });

    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(props.onExpandAll).toHaveBeenCalledTimes(1);

    cleanup();
    const allExpanded = renderGrouped({ expandedKeys: groups.map(g => g.key) });
    fireEvent.click(screen.getByRole('button', { name: '全部折叠' }));
    expect(allExpanded.onCollapseAll).toHaveBeenCalledTimes(1);
  });

  it('播放分组第一首：用组内第一首回调页面', () => {
    const props = renderGrouped();

    fireEvent.click(screen.getAllByRole('button', { name: '播放分组第一首' })[1]);

    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect((props.onPlay as ReturnType<typeof vi.fn>).mock.calls[0][0].name).toBe('歌曲 4');
  });

  it('点组头的展开/折叠按钮调用 onToggleGroup 并带上组 key', () => {
    const props = renderGrouped();

    // sunny 已展开 → 按钮语义是「折叠分组」；rainy 折叠 → 「展开分组」
    fireEvent.click(screen.getByRole('button', { name: '折叠分组' }));
    fireEvent.click(screen.getByRole('button', { name: '展开分组' }));

    expect(props.onToggleGroup).toHaveBeenNthCalledWith(1, 'sunny');
    expect(props.onToggleGroup).toHaveBeenNthCalledWith(2, 'rainy');
  });
});
