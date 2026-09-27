import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Song } from '@mplayer/core';
import { useSearchStore } from '../store/searchStore';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function song(id: string, name = id): Song {
  return {
    id, name, artist: 'a', album: '', url: '', cover: '', lrc: '',
    duration: 1, sourceType: 'netease',
  } as Song;
}

/**
 * #412：`setAudioTag` 由「播放成功」事件触发（playerStore），此前无论命中与否都把整份
 * `groups` 全量 map 一遍（每首歌都新建对象）——一次播放就能让整表换新、订阅者全部重渲染。
 * 这里断言**对象身份**：只有真正包含这首歌的那一组才应该换新。
 */
describe('searchStore.setAudioTag 局部更新（#412）', () => {
  beforeEach(() => {
    useSearchStore.setState({ songs: [], groups: [], expandedKeys: [] });
  });

  it('未命中任何分组时不改动 state（订阅者不被惊动）', () => {
    const group = { key: 'g1', name: 'A', artist: '', songs: [song('s1')] } as never;
    useSearchStore.setState({ songs: [], groups: [group] });
    const before = useSearchStore.getState();

    useSearchStore.getState().setAudioTag('nope', 'valid');

    const after = useSearchStore.getState();
    expect(after.groups).toBe(before.groups);
    expect(after.songs).toBe(before.songs);
  });

  it('只重建命中的那一组，其余分组保持同一引用', () => {
    const g1 = { key: 'g1', name: 'A', artist: '', songs: [song('s1')] } as never;
    const g2 = { key: 'g2', name: 'B', artist: '', songs: [song('s2')] } as never;
    const g3 = { key: 'g3', name: 'C', artist: '', songs: [song('s3')] } as never;
    useSearchStore.setState({ songs: [], groups: [g1, g2, g3] });

    useSearchStore.getState().setAudioTag('s2', 'preview');

    const groups = useSearchStore.getState().groups;
    expect(groups).toHaveLength(3);
    expect(groups[0]).toBe(g1);
    expect(groups[1]).not.toBe(g2);
    expect(groups[2]).toBe(g3);
    expect((groups[1].songs[0] as Song).audioTag).toBe('preview');
    // 同一组内没被点名的歌也必须保持同一引用
    expect(groups[0].songs[0]).toBe(g1.songs[0]);
  });

  it('扁平 songs 命中时只换那一首', () => {
    const s1 = song('s1');
    const s2 = song('s2');
    useSearchStore.setState({ songs: [s1, s2], groups: [] });

    useSearchStore.getState().setAudioTag('s2', 'invalid');

    const songs = useSearchStore.getState().songs;
    expect(songs[0]).toBe(s1);
    expect(songs[1]).not.toBe(s2);
    expect(songs[1].audioTag).toBe('invalid');
  });
});

/**
 * #412：列表行是 memo 的，任何「每帧新建」的 prop（内联闭包 / style 对象 / actions 元素）
 * 都会把 memo 击穿，表现为滚动或播放状态变化时整表重渲染。这几条把写法钉住。
 */
describe('列表 memo 纪律（#412）', () => {
  it('GroupedSongList 的组头回调是稳定引用，不包内联闭包', () => {
    const src = stripComments(read('renderer/components/GroupedSongList.tsx'));
    expect(src).toContain('onToggle={stableOnToggleGroup ?? noop}');
    expect(src).toContain('onPlayFirst={handlePlayFirst}');
    expect(src).not.toMatch(/onToggle=\{\(\) =>/);
    expect(src).not.toMatch(/onPlayFirst=\{\(\) =>/);
  });

  it('虚拟化行的定位走只吃数字的 memo 包裹层，而不是给行组件塞 style', () => {
    const src = stripComments(read('renderer/components/GroupedSongList.tsx'));
    expect(src).toContain('const VirtualRow = React.memo(');
    expect(src).toMatch(/<VirtualRow[\s\S]{0,200}start=\{virtualItem\.start\}/);
    // 行组件不再接收 style={...}
    expect(src).not.toMatch(/<SongRow[\s\S]{0,900}?style=\{/);
  });

  it('组头的回调自带分组，避免父组件逐行包闭包', () => {
    const src = stripComments(read('renderer/components/GroupHeaderRow.tsx'));
    expect(src).toContain('onToggle: (groupKey: string) => void');
    expect(src).toContain('onPlayFirst: (group: SongGroup) => void');
    expect(src).toContain('onToggle(group.key)');
    expect(src).toContain('onPlayFirst(group)');
  });

  it('队列行尾操作用渲染函数传递（元素每帧新建会击穿 memo）', () => {
    const row = stripComments(read('renderer/components/SortableSongRow.tsx'));
    expect(row).toContain('renderActions?: (song: Song, index: number) => React.ReactNode');
    expect(row).toContain('actions={renderActions?.(song, rowProps.index)}');
    expect(row).toMatch(/const dragStyle = useMemo/);

    const page = stripComments(read('renderer/pages/QueuePage.tsx'));
    expect(page).toContain('renderQueueActions');
    expect(page).not.toMatch(/actions=\{\s*</);
    expect(page).toMatch(/const queueIds = useMemo/);
    expect(page).toContain('items={queueIds}');
  });

  it('搜索页的列表回调走 useCallback', () => {
    const src = stripComments(read('renderer/pages/DiscoverPageV2.tsx'));
    expect(src).toContain('const handleSearchPlay = useCallback');
    expect(src).not.toMatch(/onPlay=\{\(song: Song\) => \{ void play\(song\); \}\}/);
  });

  it('封面刷新的并发闸门是队列而不是忙等轮询，且会话 Map 有上限', () => {
    const src = stripComments(read('renderer/utils/songCoverRefresh.ts'));
    expect(src).not.toContain('setTimeout(r, 200)');
    expect(src).toContain('waitingForSlot');
    expect(src).toContain('MAX_REMEMBERED_KEYS');
    expect(src).toContain('pruneRemembered');
  });

  it('虚拟滚动不在 scroll 事件里强制测量', () => {
    const src = stripComments(read('renderer/hooks/useVirtualRows.ts'));
    expect(src).not.toMatch(/addEventListener\('scroll', measure/);
    expect(src).toContain('ResizeObserver');
  });
});
