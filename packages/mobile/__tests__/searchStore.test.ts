import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSourceStore } from '../stores/sourceStore';
import { useSearchStore } from '../stores/searchStore';

// musicApi 打桩记录调用参数,createSearchController 用真实实现(纯逻辑)
const mocks = vi.hoisted(() => ({
  searchSongs: vi.fn(async (_kw: string, _page: number, _src: string): Promise<any[]> => []),
  searchAllSources: vi.fn(async (): Promise<any[]> => []),
  groupIntoSongGroups: vi.fn(),
}));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  return {
    ...actual,
    musicApi: {
      ...actual.musicApi,
      searchSongs: mocks.searchSongs,
      searchAllSources: mocks.searchAllSources,
      groupIntoSongGroups: mocks.groupIntoSongGroups,
    },
  };
});

vi.mock('../services/audioProbe', () => ({
  probeAudio: vi.fn(async () => 'ok'),
}));

function song(id: string, name: string, source: string) {
  return { id, name, artist: '周杰伦', album: '', duration: 100, sourceType: source, url: '', cover: '', lrc: '' };
}

// 真实分组逻辑(与 core 一致)用于断言:歌名|歌手 小写 key,组内按到达顺序
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
  mocks.searchAllSources.mockClear();
  mocks.groupIntoSongGroups.mockClear();
  useSourceStore.getState().setSelectedSource('all');
  useSearchStore.getState().clear();
});

describe('searchStore source routing', () => {
  it('passes the selected single source to searchSongs (regression: c64f05a)', async () => {
    useSourceStore.getState().setSelectedSource('qq');
    await useSearchStore.getState().search('晴天');
    expect(mocks.searchSongs).toHaveBeenCalledWith('晴天', 1, 'qq');
    expect(mocks.searchAllSources).not.toHaveBeenCalled();
  });

  it('searches every source for "all" (progressive per-source)', async () => {
    useSourceStore.getState().setSelectedSource('all');
    await useSearchStore.getState().search('晴天');
    // 渐进式: 逐源 searchSongs(每源完成即渲染), 不再用 searchAllSources 等全部
    expect(mocks.searchAllSources).not.toHaveBeenCalled();
    const calls = mocks.searchSongs.mock.calls;
    expect(calls.length).toBe(6); // netease/qq/kugou/kuwo/qianqian/soda
    for (const [kw, page] of calls) {
      expect(kw).toBe('晴天');
      expect(page).toBe(1);
    }
  });

  it('progressive: renders same-name groups incrementally as sources complete', async () => {
    // 模拟: 只有 netease 先完成(1 首), 其余源 pending
    const pending: (() => void)[] = [];
    mocks.groupIntoSongGroups.mockImplementation((songs: any[]) => realGroup(songs));
    mocks.searchSongs.mockImplementation((_kw: string, _page: number, src: string) => {
      if (src === 'netease') return Promise.resolve([song('n1', '晴天', 'netease')]);
      return new Promise((r) => { pending.push(() => r([song(`${src}1`, '晴天', src)])); });
    });

    const searchPromise = useSearchStore.getState().search('晴天');

    // netease 完成后: 结果已出现(不等其他源), 组内只有 netease 版本
    await vi.waitFor(() => {
      const results = useSearchStore.getState().results;
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('晴天');
      expect(results[0].songs).toHaveLength(1);
      expect(results[0].songs[0].sourceType).toBe('netease');
    });

    // 其余源陆续完成 → 同名歌并入已有组(组内增加版本)。
    // 搜索并发受限(3)：worker 取源是动态的，resolve 一批后可能产生新
    // pending（后取的源），循环 resolve 直到全部源完成
    while (pending.length > 0) {
      const batch = pending.splice(0);
      for (const done of batch) done();
      await new Promise((r) => setTimeout(r, 0));
    }
    await searchPromise;

    const results = useSearchStore.getState().results;
    expect(results).toHaveLength(1); // 仍是同一个同名组
    // 组内顺序 = 固定源序(不受完成顺序影响): netease 在前, kugou 在后
    const order = results[0].songs.map((s: any) => s.sourceType);
    expect(order).toEqual(['netease', 'qq', 'kugou', 'kuwo', 'qianqian', 'soda']);
  });

  it('progressive: loadMore merges page-2 groups into same-name groups (no dup)', async () => {
    mocks.groupIntoSongGroups.mockImplementation((songs: any[]) => realGroup(songs));
    // 首屏: netease 1 首
    mocks.searchSongs.mockImplementation((_kw: string, _page: number, src: string) =>
      Promise.resolve(src === 'netease' ? [song('n1', '晴天', 'netease')] : [])
    );
    await useSearchStore.getState().search('晴天');
    expect(useSearchStore.getState().results).toHaveLength(1);

    // 第二页: 全量(含 qq 的同名歌)
    mocks.searchAllSources.mockResolvedValue([{ key: '晴天|周杰伦', name: '晴天', artist: '周杰伦', songs: [song('q2', '晴天', 'qq')] }]);
    await useSearchStore.getState().loadMore();

    const results = useSearchStore.getState().results;
    expect(results).toHaveLength(1); // 同名组合并,不产生重复组
    expect(results[0].songs.map((s: any) => s.sourceType)).toEqual(['netease', 'qq']);
    expect(useSearchStore.getState().page).toBe(2);
  });
});
