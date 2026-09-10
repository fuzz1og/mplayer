import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import SongList from '@/renderer/components/SongList';

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
