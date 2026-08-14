import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSourceStore } from '../stores/sourceStore';
import { useSearchStore } from '../stores/searchStore';

// musicApi 打桩记录调用参数;SearchOrchestrator 用真实实现(纯逻辑,自持状态)
// 注意:store 走模式感知搜索入口 searchSongsRouted(T01),桩打在路由入口上
const mocks = vi.hoisted(() => ({
  searchSongs: vi.fn(async (_kw: string, _page: number, _src: string): Promise<any[]> => []),
  groupIntoSongGroups: vi.fn(),
}));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return {
    ...actual,
    musicApi: {
      ...actual.musicApi,
      searchSongsRouted: mocks.searchSongs,
      searchAllSources: undefined, // 已退役：store 不再触碰该通道
      groupIntoSongGroups: mocks.groupIntoSongGroups,
    },
  };
});

vi.mock('../services/audioProbe', () => ({
  probeAudio: vi.fn(async () => 'ok'),
}));

vi.mock('../services/songProbe', () => ({
  probeSongsWithTags: vi.fn(async () => {}),
}));

vi.mock('../stores/logsStore', () => ({
  useLogsStore: { getState: () => ({ addLog: vi.fn() }) },
}));

function song(id: string, name: string, source: string) {
  return { id, name, artist: '周杰伦', album: '', duration: 100, sourceType: source, url: '', cover: '', lrc: '' };
}

// 与 core groupIntoSongGroups 同语义的独立分组,用于断言 store 镜像出的结果形状
function realGroup(songs: any[]): any[] {
  const map = new Map<string, any>();
  for (const s of songs) {
    const key = `${s.name.trim().toLowerCase()}|${s.artist.trim().toLowerCase()}`;
    const ex = map.get(key);
    if (ex) ex.songs.push(s);
    else map.set(key, { key, name: s.name, artist: s.artist, songs: [s] });
  }
  return Array.from(map.values());
}

beforeEach(() => {
  mocks.searchSongs.mockClear();
  mocks.groupIntoSongGroups.mockClear();
  useSourceStore.getState().setSelectedSource('all');
  useSearchStore.getState().clear();
});

describe('searchStore 退化为编排器绑定', () => {
  it('把所选单源传给 searchSongs（source 路由留在 store）', async () => {
    useSourceStore.getState().setSelectedSource('qq');
    await useSearchStore.getState().search('晴天');
    expect(mocks.searchSongs).toHaveBeenCalledWith('晴天', 1, 'qq');
  });

  it('"all" 走渐进：逐源 searchSongs（不再用 searchAllSources）', async () => {
    useSourceStore.getState().setSelectedSource('all');
    await useSearchStore.getState().search('晴天');
    const calls = mocks.searchSongs.mock.calls;
    expect(calls.length).toBe(7); // netease/qq/kugou/kuwo/migu/qianqian/soda（T05 重引入 migu）
    for (const [kw, page] of calls) {
      expect(kw).toBe('晴天');
      expect(page).toBe(1);
    }
    // 通道已退役：store 不应尝试触碰 searchAllSources
    expect(mocks.groupIntoSongGroups).not.toHaveBeenCalled();
  });

  it('subscribe 镜像：all 渐进结果按固定源序合并、组内跨源同名保留', async () => {
    mocks.groupIntoSongGroups.mockImplementation((songs: any[]) => realGroup(songs));
    // 只有 netease 先完成,其余源 pending → 验证渐进渲染(store 镜像编排器中途状态)
    const pending: (() => void)[] = [];
    mocks.searchSongs.mockImplementation((_kw: string, _page: number, src: string) => {
      if (src === 'netease') return Promise.resolve([song('n1', '晴天', 'netease')]);
      return new Promise((r) => { pending.push(() => r([song(`${src}1`, '晴天', src)])); });
    });

    const searchPromise = useSearchStore.getState().search('晴天');

    await vi.waitFor(() => {
      const results = useSearchStore.getState().results;
      expect(results.length).toBe(1);
      expect(results[0].songs.map((s: any) => s.sourceType)).toEqual(['netease']);
    });

    // 其余源陆续完成,组内并入;顺序 = 固定源序
    while (pending.length > 0) {
      const batch = pending.splice(0);
      for (const done of batch) done();
      await new Promise((r) => setTimeout(r, 0));
    }
    await searchPromise;

    const order = useSearchStore.getState().results[0].songs.map((s: any) => s.sourceType);
    expect(order).toEqual(['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qianqian', 'soda']);
  });

  it('单源结果镜像后,name 映射为中文源名（渲染层标题）', async () => {
    useSourceStore.getState().setSelectedSource('qq');
    mocks.searchSongs.mockResolvedValue([song('q1', '晴天', 'qq')]);
    await useSearchStore.getState().search('晴天');
    const results = useSearchStore.getState().results;
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('QQ音乐');
  });

  it('clear 重置为初始态', async () => {
    useSourceStore.getState().setSelectedSource('qq');
    mocks.searchSongs.mockResolvedValue([song('q1', '晴天', 'qq')]);
    await useSearchStore.getState().search('晴天');
    expect(useSearchStore.getState().results.length).toBeGreaterThan(0);

    useSearchStore.getState().clear();
    const s = useSearchStore.getState();
    expect(s.results).toEqual([]);
    expect(s.query).toBe('');
    expect(s.loading).toBe(false);
  });
});
