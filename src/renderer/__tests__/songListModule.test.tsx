import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song, SongGroup } from '@mplayer/core';
import SongList from '@/renderer/components/SongList';
import GroupedSongList from '@/renderer/components/GroupedSongList';
import { getNextSongInQueue, usePlayerStore } from '@/renderer/store/playerStore';

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

/** jsdom 没有布局：给滚动容器造一个 900x600 的视口，@tanstack/react-virtual 才能算出窗口。 */
function mountScrollContainer(): HTMLDivElement {
  const el = document.createElement('div');
  // 生产代码按 data-scroll-container 认滚动容器（jsdom 不加载 CSS 文件，computed overflow 读不到）
  el.setAttribute('data-scroll-container', '');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 900, configurable: true });
  // @tanstack/react-virtual 量的是 offsetWidth/offsetHeight，jsdom 里恒为 0
  Object.defineProperty(el, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(el, 'offsetWidth', { value: 900, configurable: true });
  el.getBoundingClientRect = () => ({
    width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  document.body.appendChild(el);
  return el;
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
    const scrollEl = mountScrollContainer();

    // 挂到 document 后再让 virtualizer 量一次：jsdom 里全量布局都靠这些 defineProperty 撑着
    const { container } = render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={() => {}} showHeader={false} />
      </MemoryRouter>,
      { container: scrollEl }
    );

    // 断言 DOM 实际挂了多少行，而不是 coverRenders 的累计次数——
    // 后者在「探测到滚动容器之前的那一帧」已按整表渲染记过一轮（那是设计上的兜底）。
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('.song-row').length).toBeLessThan(40);
    expect(container.textContent).toContain('歌曲 0');
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

describe('歌曲列表模块：资料库密度（density=library）', () => {
  it('默认无表头，行挂 library variant，时长列常驻', () => {
    const songs = [song(1), song(2)];
    const { container } = render(
      <MemoryRouter>
        <SongList
          songs={songs}
          onPlay={() => {}}
          density="library"
          showDuration
          onDownload={() => {}}
          onToggleFavorite={() => {}}
        />
      </MemoryRouter>
    );

    expect(container.querySelector('.song-list')).toHaveAttribute('data-density', 'library');
    expect(container.querySelector('.song-list__head')).toBeNull();

    const rows = container.querySelectorAll('.song-row');
    expect(rows).toHaveLength(songs.length);
    expect(rows[0]).toHaveAttribute('data-variant', 'library');
    // 240s → 4:00，列宽由 COL_DURATION = 50 下发
    expect(rows[0].querySelector('.song-row__duration')?.textContent).toBe('4:00');
    expect(
      (rows[0].querySelector('.song-row__duration') as HTMLElement).style.getPropertyValue('--col-width'),
    ).toBe('50px');
  });

  it('行尾只留一个 28px 圆形 More，下载/收藏按顺序收进菜单', () => {
    render(
      <MemoryRouter>
        <SongList
          songs={[song(1)]}
          onPlay={() => {}}
          density="library"
          onDownload={() => {}}
          onToggleFavorite={() => {}}
          showHeader={false}
        />
      </MemoryRouter>
    );

    const row = document.querySelector('.song-row') as HTMLElement;
    const actionButtons = row.querySelectorAll('.row-actions button');
    expect(actionButtons).toHaveLength(1);
    expect(actionButtons[0]).toHaveAttribute('aria-label', '更多操作: 歌曲 1');
    expect(row.querySelector('.row-actions')).toHaveClass('row-actions--compact');

    fireEvent.click(actionButtons[0]);
    const labels = Array.from(document.querySelectorAll('.row-menu__item')).map((item) => item.textContent?.trim());
    // 顺序契约：下载、收藏、原 menuItems（下一首播放、加入歌单、换源完整版、查看歌手）
    expect(labels.slice(0, 2)).toEqual(['下载', '收藏']);
    expect(labels.slice(2, 4)).toEqual(['下一首播放', '加入歌单']);
  });

  it('长列表虚拟滚动的行高估计按 library 密度为 46', async () => {
    const songs = Array.from({ length: 200 }, (_, i) => song(i));
    const scrollEl = mountScrollContainer();
    const { container } = render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={() => {}} density="library" showHeader={false} />
      </MemoryRouter>,
      { container: scrollEl }
    );

    const rowsEl = container.querySelector('.song-list__rows') as HTMLElement;
    await waitFor(() => expect(container.querySelectorAll('.song-row').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('.song-row').length).toBeLessThan(40);
    // 200 × 46 = 9200：estimate 与 CSS min-height 46 是同一份布局事实
    expect(rowsEl.style.getPropertyValue('--total-size')).toBe('9200px');
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

  it('播放分组第一首：回传该组歌曲队列与组内下标 0', () => {
    const props = renderGrouped();

    fireEvent.click(screen.getAllByRole('button', { name: '播放分组第一首' })[1]);

    expect(props.onPlay).toHaveBeenCalledTimes(1);
    const [picked, queue, index] = (props.onPlay as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(picked.name).toBe('歌曲 4');
    // D1：组头播放第一首 = 该组队列 + 组内下标 0，不是跨组扁平化后的全局下标
    expect(queue.map((s: Song) => s.id)).toEqual(['netease:4', 'netease:5']);
    expect(index).toBe(0);
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

/**
 * #697 点播契约：列表只回传 (song, 展示队列, 下标)，绝不隐式写 playerStore。
 * 队列与播放由调用方负责（D2）；分组列表的队列是该组 songs（D1）。
 */
describe('歌曲列表点播契约（#697）', () => {
  const oldQueue = [song(99)];

  const rowPlayButton = (rowIndex: number): HTMLElement => {
    const row = document.querySelectorAll('.song-row')[rowIndex] as HTMLElement;
    expect(row, `第 ${rowIndex} 行不存在`).toBeTruthy();
    return row.querySelector('.song-row__cover-play') as HTMLElement;
  };

  beforeEach(() => {
    usePlayerStore.setState({ currentPlaylist: oldQueue, currentPlaylistIndex: 0, currentSong: null });
  });

  it('普通列表：回传歌曲 + 当前展示队列 + 行下标，自身不改播放队列', () => {
    const songs = [song(1), song(2), song(3)];
    const onPlay = vi.fn();
    render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={onPlay} showHeader={false} />
      </MemoryRouter>
    );

    fireEvent.click(rowPlayButton(1));

    expect(onPlay).toHaveBeenCalledTimes(1);
    const [picked, queue, index] = onPlay.mock.calls[0];
    expect(picked.id).toBe('netease:2');
    expect(queue.map((s: Song) => s.id)).toEqual(['netease:1', 'netease:2', 'netease:3']);
    expect(index).toBe(1);
    // 列表不再隐式写 playerStore：旧队列原样保留（唯一写队列的是调用方）
    expect(usePlayerStore.getState().currentPlaylist).toBe(oldQueue);
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
  });

  it('分组列表：队列长度等于组内歌曲数、下标是组内下标，且不残留旧歌单', () => {
    const groups: SongGroup[] = [
      { key: 'sunny', name: '晴天', artist: '周杰伦', songs: [song(1), song(2), song(3)] },
      { key: 'rainy', name: '雨天', artist: '孙燕姿', songs: [song(4), song(5)] },
    ];
    const onPlay = vi.fn();
    render(
      <MemoryRouter>
        <GroupedSongList
          groups={groups}
          expandedKeys={['sunny', 'rainy']}
          onToggleGroup={vi.fn()}
          onExpandAll={vi.fn()}
          onCollapseAll={vi.fn()}
          onPlay={onPlay}
          onToggleFavorite={vi.fn()}
          selectedIds={[]}
          onSelectionChange={vi.fn()}
        />
      </MemoryRouter>
    );

    // 组内第 2 首（歌曲 2）：queue 必须是 sunny 组，而不是跨组扁平化的全部结果
    fireEvent.click(rowPlayButton(1));

    expect(onPlay).toHaveBeenCalledTimes(1);
    const [picked, queue, index] = onPlay.mock.calls[0];
    expect(picked.id).toBe('netease:2');
    expect(queue).toHaveLength(groups[0].songs.length);
    expect(queue.map((s: Song) => s.id)).toEqual(['netease:1', 'netease:2', 'netease:3']);
    expect(index).toBe(1);
    expect(usePlayerStore.getState().currentPlaylist).toBe(oldQueue);

    // 换到 rainy 组：队列换成该组自己的两首，绝不残留上一次的旧歌单
    fireEvent.click(rowPlayButton(3));
    const [, rainyQueue, rainyIndex] = onPlay.mock.calls[1];
    expect(rainyQueue).toHaveLength(groups[1].songs.length);
    expect(rainyQueue.map((s: Song) => s.id)).toEqual(['netease:4', 'netease:5']);
    expect(rainyIndex).toBe(0);
    expect(usePlayerStore.getState().currentPlaylist).toBe(oldQueue);
  });

  it('调用方按契约写法建立队列后，下一首语义保持（回归）', () => {
    const songs = [song(1), song(2), song(3)];
    const onPlay = vi.fn((picked: Song, queue: Song[], index: number) => {
      usePlayerStore.getState().setCurrentPlaylist(queue, index);
      // 真实 play() 会同步 currentSong；这里只替换队列写入，手动补上以验证推进语义
      usePlayerStore.setState({ currentSong: picked });
    });
    render(
      <MemoryRouter>
        <SongList songs={songs} onPlay={onPlay} showHeader={false} />
      </MemoryRouter>
    );

    fireEvent.click(rowPlayButton(1));

    const state = usePlayerStore.getState();
    expect(state.currentPlaylist.map((s) => s.id)).toEqual(['netease:1', 'netease:2', 'netease:3']);
    expect(state.currentPlaylistIndex).toBe(1);
    expect(getNextSongInQueue(state)?.id).toBe('netease:3');
  });
});
