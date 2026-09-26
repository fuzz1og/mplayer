import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Song } from '@mplayer/core';

/** 读仓库内源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');
/** 源码断言必须去掉注释：注释里常常**引用**被禁掉的旧写法，否则守卫会误伤自己 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

import {
  computeSongListLayout,
  GROUP_HEADER_HEIGHT,
  GROUP_HEADER_QUIET_HEIGHT,
  SONG_ROW_LAYOUT_HEIGHT,
  SECTION_HEADER_HEIGHT,
  songListRowHeight,
} from '../components/songListLayout';
import type { SongListRow } from '../components/songListLayout';

function song(id: string): Song {
  return { id, name: 'x', artist: 'y', album: '', url: '', cover: '', lrc: '', duration: 1, sourceType: 'netease' };
}

/**
 * #411 守卫：列表渲染的几条纪律都是「没人看着就会退回去」的东西——
 * 行高算术、memo、稳定回调、key 不含 index、窗口档位单点。
 */
describe('列表行高与偏移（#411）', () => {
  it('三种行的固定高度', () => {
    expect(songListRowHeight({ kind: 'song', key: 'a', song: song('a') })).toBe(SONG_ROW_LAYOUT_HEIGHT);
    expect(songListRowHeight({ kind: 'sectionHeader', key: 'h', title: 't' })).toBe(SECTION_HEADER_HEIGHT);
    expect(songListRowHeight({ kind: 'groupHeader', key: 'g', title: 't' })).toBe(GROUP_HEADER_HEIGHT);
    expect(songListRowHeight({ kind: 'groupHeader', key: 'g', title: 't', quiet: true })).toBe(GROUP_HEADER_QUIET_HEIGHT);
  });

  it('偏移按行类型累加（组头 + 若干歌曲行）', () => {
    const rows: SongListRow[] = [
      { kind: 'groupHeader', key: 'g', title: '歌名' },
      { kind: 'song', key: 's1', song: song('s1') },
      { kind: 'song', key: 's2', song: song('s2') },
      { kind: 'sectionHeader', key: 'h', title: '历史' },
      { kind: 'song', key: 's3', song: song('s3') },
    ];

    const { offsets, lengths } = computeSongListLayout(rows);

    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(GROUP_HEADER_HEIGHT);
    expect(offsets[2]).toBe(GROUP_HEADER_HEIGHT + SONG_ROW_LAYOUT_HEIGHT);
    expect(offsets[3]).toBe(GROUP_HEADER_HEIGHT + SONG_ROW_LAYOUT_HEIGHT * 2);
    expect(offsets[4]).toBe(GROUP_HEADER_HEIGHT + SONG_ROW_LAYOUT_HEIGHT * 2 + SECTION_HEADER_HEIGHT);
    expect(lengths).toEqual([
      GROUP_HEADER_HEIGHT,
      SONG_ROW_LAYOUT_HEIGHT,
      SONG_ROW_LAYOUT_HEIGHT,
      SECTION_HEADER_HEIGHT,
      SONG_ROW_LAYOUT_HEIGHT,
    ]);
  });

  it('空列表不炸（偏移数组为空）', () => {
    expect(computeSongListLayout([])).toEqual({ offsets: [], lengths: [] });
  });
});

describe('列表渲染纪律（#411）', () => {
  it('SongRow 是 memo 组件', () => {
    const source = read('components/SongRow.tsx');
    expect(source).toMatch(/export default memo\(SongRow\)/);
    expect(source).toMatch(/^import \{[^}]*memo[^}]*\} from 'react';/m);
  });

  it('SongList 提供 getItemLayout，且 key 从不拼 index', () => {
    const source = read('components/SongList.tsx');
    expect(source).toContain('getItemLayout');
    // 传了 ListHeaderComponent 就放弃 getItemLayout（错的偏移比没有更糟）
    expect(source).toMatch(/ListHeaderComponent \? undefined : getItemLayout/);
    expect(source).not.toMatch(/key:.*index/);
    expect(source).not.toMatch(/keyExtractor=\{\([^)]*,\s*\w*index/);
  });

  it('列表页不再自己拿 FlatList 铺 SongRow（一律走 SongList）', () => {
    for (const file of ['app/favorites.tsx', 'app/history.tsx', 'app/hotlist.tsx']) {
      const source = read(file);
      expect(source, file).toContain("from '../components/SongList'");
      expect(source, file).not.toMatch(/<SongRow/);
    }
    // 搜索页两种结果视图都拍平（此前「组」当 cell、组内 map 全量渲染）
    const search = stripComments(read('app/(tabs)/search.tsx'));
    expect(search).not.toContain('group.songs.map(');
    // 注意排除 <SongListSkeleton（前缀相同）：\s 或 / 才说明是 SongList 本身
    expect((search.match(/<SongList[\s/]/g) ?? []).length).toBe(2);
  });

  it('行回调是 useCallback 且不内联（否则 SongRow 的 memo 逐帧失效）', () => {
    for (const file of ['app/favorites.tsx', 'app/history.tsx', 'app/hotlist.tsx']) {
      const source = read(file);
      expect(source, file).toContain('useCallback');
      // SongRow 的 prop 里不应出现内联箭头
      expect(source, file).not.toMatch(/on(Swap|Remove|Press)=\{[^}]*=>/);
    }
    // hero 页（album/artist/playlist）的 onSwap 同样必须稳定
    for (const file of ['app/album/[id].tsx', 'app/artist/[id].tsx', 'app/discover-playlist/[id].tsx']) {
      expect(read(file), file).toMatch(/const handleSwap = useCallback/);
    }
  });

  it('key 不含 index（删一项不该把它后面所有行重挂载）', () => {
    expect(read('app/history.tsx')).not.toMatch(/keyExtractor=\{\(item, index\)/);
    const queue = read('components/QueueListModal.tsx');
    expect(queue).not.toMatch(/\$\{item\.id\}-\$\{i\}/);
    expect(queue).toMatch(/keyExtractor=\{\(row\) => row\.key\}/);
  });

  it('窗口档位单点，SongList 与 CollapsingHero 共用', () => {
    const window = read('components/listWindow.ts');
    expect(window).toContain('windowSize');
    expect(read('components/SongList.tsx')).toContain('listWindowProps');
    expect(read('components/CollapsingHero.tsx')).toContain('listWindowProps');
  });

  it('不显式打开 removeClippedSubviews（Android 默认已开，iOS 默认关是有原因的）', () => {
    // RN FlatList 文档：「The default value is true for Android」——iOS 默认 false，
    // 因为它在该平台有已知裁剪问题。显式传 true 等于把 iOS 拉进那个坑、Android 收益为零。
    const window = stripComments(read('components/listWindow.ts'));
    expect(window).not.toContain('removeClippedSubviews');
  });

  it('固定行高的队列列表也给 getItemLayout，且行高从 token 派生', () => {
    const queue = read('components/QueueListModal.tsx');
    expect(queue).toContain('getItemLayout');
    expect(queue).toMatch(/QUEUE_ROW_HEIGHT =[\s\S]*textVariants\.body\.lineHeight/);
  });

  it('「列表内原位替换」只有一份实现（三个 hero 页共用）', () => {
    expect(read('services/songListOps.ts')).toContain('export function replaceSongInList');
    for (const file of ['app/album/[id].tsx', 'app/artist/[id].tsx', 'app/discover-playlist/[id].tsx']) {
      const source = stripComments(read(file));
      expect(source, file).toContain('replaceSongInList');
      // 不再各写一份 map 替换体
      expect(source, file).not.toMatch(/prev\.map\(\(s\) => \(s\.id === original\.id/);
    }
  });

  it('搜索页的拍平只有一处实现（两种视图共用 flattenSongGroups）', () => {
    const search = stripComments(read('app/(tabs)/search.tsx'));
    expect(search).toContain('function flattenSongGroups');
    // 组内 map 已消失；两处调用同一函数
    expect((search.match(/flattenSongGroups\(results, '/g) ?? []).length).toBe(2);
  });

  it('整店订阅已改为选择器订阅', () => {
    expect(read('app/favorites.tsx')).toMatch(/useFavoriteStore\(\(s\) => s\.favorites\)/);
    expect(read('app/history.tsx')).toMatch(/useHistoryStore\(\(s\) => s\.history\)/);
    expect(read('app/history.tsx')).not.toMatch(/const \{[^}]*\} = useHistoryStore\(\)/);
  });

  it('audioTagStore 有容量上限（长会话不再只增不减）', () => {
    const store = read('stores/audioTagStore.ts');
    expect(store).toMatch(/MAX_TAGS/);
    expect(store).toMatch(/delete next\[/);
  });
});
