import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // 行高协议由 songRowMetrics 单源下发（46px 行 / 30px 封面）
    expect((rows[0] as HTMLElement).style.getPropertyValue('--song-row-height')).toBe('46px');
    expect((rows[0] as HTMLElement).style.getPropertyValue('--song-row-cover')).toBe('30px');
    // 240s → 4:00，列宽由 COL_DURATION_LIBRARY = 44 下发
    expect(rows[0].querySelector('.song-row__duration')?.textContent).toBe('4:00');
    expect(
      (rows[0].querySelector('.song-row__duration') as HTMLElement).style.getPropertyValue('--col-width'),
    ).toBe('44px');
    expect(
      (rows[0].querySelector('.row-actions') as HTMLElement).style.getPropertyValue('--col-width'),
    ).toBe('56px');
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
    const labels = Array.from(document.querySelectorAll('.ui-menu__item')).map((item) => item.textContent?.trim());
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

describe('歌曲列表模块：选择模式入口（#694 评审）', () => {
  it('进入/退出共用一个切换按钮：节点不卸载、焦点不落 body，取消与完成不再各挂一份相同处理器', async () => {
    render(
      <MemoryRouter>
        <SongList
          songs={[song(1), song(2)]}
          onPlay={() => {}}
          showHeader={false}
          enableBatchDownload
          onBatchDownload={() => {}}
        />
      </MemoryRouter>
    );

    const toggle = screen.getByRole('button', { name: '选择' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.focus();
    await userEvent.click(toggle);

    // 修前：「选择」被卸载、换成「取消」+「完成」两个按钮 → 焦点落 body，且两者绑同一个 handler
    const done = screen.getByRole('button', { name: '完成' });
    expect(done).toHaveAttribute('aria-pressed', 'true');
    expect(done).toBe(toggle);
    expect(document.activeElement).toBe(done);

    await userEvent.click(done);
    const back = screen.getByRole('button', { name: '选择' });
    expect(back).toBe(toggle);
    expect(document.activeElement).toBe(back);
  });
});

describe('分组搜索结果：默认扁平 + 就地展开其余版本（#694）', () => {
  const groups: SongGroup[] = [
    { key: 'sunny', name: '晴天', artist: '周杰伦', songs: [song(1), song(2), song(3)] },
    { key: 'rainy', name: '雨天', artist: '孙燕姿', songs: [song(4), song(5)] },
  ];
  const songTitle = (name: string) => screen.queryByText(name, { selector: '.song-row__title' });

  const renderGrouped = (overrides: Partial<React.ComponentProps<typeof GroupedSongList>> = {}) => {
    const props = {
      groups,
      expandedKeys: [] as string[],
      onToggleGroup: vi.fn(),
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

  it('默认扁平：每组只渲染最相关的一版，不再有组标题行与「全部展开」', () => {
    renderGrouped();

    expect(document.querySelectorAll('.song-row')).toHaveLength(groups.length);
    expect(songTitle('歌曲 1')).not.toBeNull();
    expect(songTitle('歌曲 4')).not.toBeNull();
    // 其余版本默认不渲染，顶部也没有「全部展开」大按钮
    expect(songTitle('歌曲 2')).toBeNull();
    expect(songTitle('歌曲 5')).toBeNull();
    expect(screen.queryByRole('button', { name: '全部展开' })).toBeNull();
    // 结果区顶部只有一行轻说明
    expect(screen.getByText('2 首 · 已按相关度排序')).toBeInTheDocument();
    // 每行都是 46px 资料库密度（与最终形态同高）
    for (const row of Array.from(document.querySelectorAll('.song-row')) as HTMLElement[]) {
      expect(row.style.getPropertyValue('--song-row-height')).toBe('46px');
    }
  });

  it('行尾「N 个版本」就地展开：aria-expanded + 缩进 16px 的其余版本', () => {
    const props = renderGrouped();

    const versions = screen.getAllByRole('button', { name: /个版本/ });
    expect(versions.map((b) => b.textContent)).toEqual(['3 个版本', '2 个版本']);
    expect(versions[0]).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(versions[0]);
    expect(props.onToggleGroup).toHaveBeenCalledWith('sunny');

    cleanup();
    renderGrouped({ expandedKeys: ['sunny'] });
    expect(screen.getByRole('button', { name: /3 个版本/ })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelectorAll('.sgroup__rest')).toHaveLength(1);
    expect(songTitle('歌曲 2')).not.toBeNull();
    expect(songTitle('歌曲 3')).not.toBeNull();
    // 没展开的那组仍然只有一版
    expect(songTitle('歌曲 5')).toBeNull();
  });

  it('展开/收起走同一按钮：行 memo 不能把 aria-expanded 停在旧值（#694 Electron 回归）', () => {
    const Controlled = () => {
      const [expanded, setExpanded] = useState<string[]>([]);
      return (
        <GroupedSongList
          groups={groups}
          expandedKeys={expanded}
          onToggleGroup={(key) => setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
          onPlay={vi.fn()}
          onToggleFavorite={vi.fn()}
          selectedIds={[]}
          onSelectionChange={vi.fn()}
        />
      );
    };
    render(<MemoryRouter><Controlled /></MemoryRouter>);

    const toggle = screen.getByRole('button', { name: /3 个版本/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /3 个版本/ })).toHaveAttribute('aria-expanded', 'true');
    expect(songTitle('歌曲 2')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /3 个版本/ }));
    expect(screen.getByRole('button', { name: /3 个版本/ })).toHaveAttribute('aria-expanded', 'false');
    expect(songTitle('歌曲 2')).toBeNull();
  });

  it('单版本组不渲染「N 个版本」按钮', () => {
    renderGrouped({ groups: [{ key: 'only', name: '单曲', artist: '歌手', songs: [song(9)] }] });

    expect(screen.queryByRole('button', { name: /个版本/ })).toBeNull();
  });

  it('展开后点其中一首：队列 = 该组版本 + 组内下标（D1）', () => {
    const props = renderGrouped({ expandedKeys: ['sunny'] });

    const rows = Array.from(document.querySelectorAll('.song-row')) as HTMLElement[];
    const second = rows.find((row) => row.textContent?.includes('歌曲 2')) as HTMLElement;
    fireEvent.click(second.querySelector('.song-row__cover-play') as HTMLElement);

    expect(props.onPlay).toHaveBeenCalledTimes(1);
    const [picked, queue, index] = (props.onPlay as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(picked.id).toBe('netease:2');
    expect(queue.map((s: Song) => s.id)).toEqual(['netease:1', 'netease:2', 'netease:3']);
    expect(index).toBe(1);
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

/**
 * #699 歌曲行密度协议：普通 / 分组 / 可排序 / 骨架 / 虚拟测量必须同源。
 * 断言落在 DOM 的 --song-row-* 变量与批量状态机（几何由 Playwright 在真实 Chromium 验）。
 */
describe('共享歌曲行密度协议与按需选择模式（#699）', () => {
  const renderList = (props: Partial<React.ComponentProps<typeof SongList>> = {}) => render(
    <MemoryRouter>
      <SongList songs={[song(1), song(2)]} onPlay={() => {}} showHeader={false} {...props} />
    </MemoryRouter>
  );

  it('standard / library 的行高与封面来自同一份协议变量', () => {
    const standard = renderList();
    const standardRow = standard.container.querySelector('.song-row') as HTMLElement;
    expect(standardRow.style.getPropertyValue('--song-row-height')).toBe('64px');
    expect(standardRow.style.getPropertyValue('--song-row-cover')).toBe('44px');
    cleanup();

    const library = renderList({ density: 'library', showDuration: true });
    const libraryRow = library.container.querySelector('.song-row') as HTMLElement;
    expect(libraryRow.style.getPropertyValue('--song-row-height')).toBe('46px');
    expect(libraryRow.style.getPropertyValue('--song-row-cover')).toBe('30px');
  });

  it('骨架屏消费同一组密度变量：加载前后行高不跳', () => {
    const { container } = renderList({ songs: [], loading: true, density: 'library' });
    const row = container.querySelector('.song-skeleton__row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.getPropertyValue('--song-row-height')).toBe('46px');
    expect(row.style.getPropertyValue('--song-row-cover')).toBe('30px');
    expect(container.querySelector('.song-row')).toBeNull();
  });

  it('选择模式状态机：默认无复选框 → 选择/勾选/批量 → 完成清空', async () => {
    const onBatchDownload = vi.fn();
    const onBatchDelete = vi.fn();
    const view = renderList({
      density: 'library',
      enableBatchDownload: true,
      onBatchDownload,
      enableBatchDelete: true,
      onBatchDelete,
      enableBatchAddToPlaylist: true,
    });
    const { container } = view;

    // 普通浏览：无复选框、无可见工具栏
    expect(container.querySelector('.song-row__check')).toBeNull();
    expect(container.querySelector('.song-list__batch-wrap')).not.toHaveAttribute('data-visible');

    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    const checks = container.querySelectorAll('.song-row__check input');
    expect(checks).toHaveLength(2);
    expect(screen.getByRole('toolbar', { name: '批量操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量下载' })).toBeDisabled();

    fireEvent.click(checks[0] as HTMLElement);
    fireEvent.click(checks[1] as HTMLElement);
    expect(screen.getByText('已选择 2 首歌曲')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '批量下载' }));
    expect(onBatchDownload).toHaveBeenCalledTimes(1);
    expect((onBatchDownload.mock.calls[0][0] as Song[]).map((item) => item.id)).toEqual(['netease:1', 'netease:2']);
    await waitFor(() => expect(screen.getByText('已选择 0 首歌曲')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(container.querySelector('.song-row__check')).toBeNull();
    expect(container.querySelector('.song-list__batch-wrap')).not.toHaveAttribute('data-visible');

    // 再次进入选择模式：退出时已清空选择
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    expect(screen.getByText('已选择 0 首歌曲')).toBeInTheDocument();
  });
});
