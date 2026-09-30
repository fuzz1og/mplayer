import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Song } from '@mplayer/core';
import { useSearchStore } from '../store/searchStore';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 本文件在 <root>/src/renderer/__tests__/ 下，基准取 <root>/src */
const read = (rel: string) => readFileSync(join(testDir, '..', '..', rel), 'utf8');
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

  it('同一首歌出现在多个组时，每个命中的组都要刷新', () => {
    const dup = song('dup');
    const g1 = { key: 'g1', name: 'A', artist: '', songs: [dup] } as never;
    const g2 = { key: 'g2', name: 'B', artist: '', songs: [{ ...dup }] } as never;
    const g3 = { key: 'g3', name: 'C', artist: '', songs: [song('other')] } as never;
    useSearchStore.setState({ songs: [], groups: [g1, g2, g3] });

    useSearchStore.getState().setAudioTag('dup', 'valid');

    const groups = useSearchStore.getState().groups;
    expect(groups[0]).not.toBe(g1);
    expect(groups[1]).not.toBe(g2);
    expect(groups[2]).toBe(g3);
    expect((groups[0].songs[0] as Song).audioTag).toBe('valid');
    expect((groups[1].songs[0] as Song).audioTag).toBe('valid');
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

  it('虚拟化定位是**一份**共享实现（VirtualRow），且只吃数字', () => {
    const shared = stripComments(read('renderer/components/VirtualRow.tsx'));
    expect(shared).toContain('const VirtualRow = React.memo(');
    // props 只有数字 → 数字相等即不重渲染
    expect(shared).toContain('start: number;');
    expect(shared).toContain('size: number;');
    expect(shared).toContain('scrollMargin: number;');

    // 三个列表消费者都用它，不再各自在 map 里现场拼 style
    for (const file of ['renderer/components/SongList.tsx', 'renderer/components/GroupedSongList.tsx', 'renderer/components/VirtualSortableList.tsx']) {
      const src = stripComments(read(file));
      // 同目录的组件用相对路径、跨目录用 @ 别名，两种都算
      expect(src, file).toMatch(/import VirtualRow from '(\.\/|@\/renderer\/components\/)VirtualRow'/);
      expect(src, file).toContain('<VirtualRow');
      expect(src, file).not.toMatch(/position: 'absolute'/);
    }
  });

  it('行组件不再接收每帧新建的 style 对象', () => {
    const src = stripComments(read('renderer/components/GroupedSongList.tsx'));
    const songRowBlock = /<SongRow[\s\S]*?\/>/.exec(src)?.[0] ?? '';
    expect(songRowBlock).not.toBe('');
    expect(songRowBlock).not.toContain('style=');
    // 组头也不再有 style 这个死 prop
    expect(stripComments(read('renderer/components/GroupHeaderRow.tsx'))).not.toContain('style?:');
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
    // #428：队列页不再自己接 dnd-kit，也不再有裸 map —— 全量 id / items / DragOverlay 收在共享能力里
    expect(page).toContain('renderQueueDragPreview');
    expect(page).not.toContain('currentPlaylist.map');
  });

  it('renderer 页面不自己接 dnd-kit，也不内联新建排序 id 数组（#428 / #445 通用规则）', () => {
    const dir = join(testDir, '..', '..', 'renderer', 'pages');
    const pages = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
    expect(pages.length).toBeGreaterThan(5);
    for (const file of pages) {
      const src = stripComments(read(`renderer/pages/${file}`));
      // 窗口化 + 可排序是共享能力（VirtualSortableList / SongList），页面不自己拼 DndContext
      expect(src, file).not.toMatch(/@dnd-kit/);
      // items={list.map(...)} 每帧新建数组：dnd-kit 的排序下标来自这份 items，必须 memo 化
      expect(src, file).not.toMatch(/items=\{\s*[\w.]*\.map\(/);
    }
  });

  it('本地歌单页接入共享的窗口化排序列表（#445 / #488）', () => {
    const page = stripComments(read('renderer/pages/PlaylistDetailPage.tsx'));
    expect(page).toContain('VirtualSortableList');
    // 展示集合（#445 是全量 songs，memo 由能力内部保证；#488 起是过滤派生的 visibleSongs）交给能力层；
    // 两种形态都是 memo 化引用——窗口化与 dnd-kit 的下标来源必须是同一个数组，不能内联 .map( 新建
    expect(page).toContain('items={visibleSongs}');
    // 三个渲染函数（sortable 行 + 非 sortable 预览 + 过滤态静态行）从**同一份** props 展开：
    // 本页 19 个 prop，抄三份必然静默漂移
    expect(page).toContain('const sharedRowProps = useMemo(');
    expect(page).toContain('const buildRowProps = useCallback(');
    expect((page.match(/\{\.\.\.buildRowProps\(song, index\)\}/g) ?? []).length).toBe(3);
    expect(page).toContain('dragHandle={previewDragHandle}');
    // 提示条 / 批量栏 / 表头 / 过滤框走 header 插槽（与 rowsRef 同父由组件结构保证，见 VirtualSortableList）
    expect(page).toContain('header={');
  });

  it('行高 64 是布局唯一来源：没有 measureElement，estimateSize 就是布局（#445）', () => {
    const hooks = stripComments(read('renderer/hooks/useVirtualRows.ts'));
    expect(hooks).toContain('export const SONG_ROW_HEIGHT = 64');
    const list = stripComments(read('renderer/components/VirtualSortableList.tsx'));
    expect(list).toContain('const estimateSongRow = () => SONG_ROW_HEIGHT');
    // 全仓没有 measureElement → virtualItem.size 永远等于 estimateSize：
    // 真实行高与常量不符时行会互相压叠且不报错，所以常量必须与 SongRow 的布局一致
    expect(list).not.toContain('measureElement');
    expect(stripComments(read('renderer/components/VirtualRow.tsx'))).toMatch(/height: `\$\{size\}px`/);
    const row = stripComments(read('renderer/components/SongRow.tsx'));
    // 44px 封面盒 + 上下各 10px 内边距 = 64；标题/副标题 nowrap 不换行，专辑列可有可无
    expect(row).toContain("width: '44px', height: '44px'");
    expect(row).toContain("padding: compact ? '8px 12px' : '10px 16px'");
    expect(row).toContain("whiteSpace: 'nowrap'");
  });

  it('队列窗口化与可排序收在共享能力里（#428）', () => {
    const list = stripComments(read('renderer/components/VirtualSortableList.tsx'));
    // items 必须是**全量有序 id** 且 memo 化：dnd-kit 的排序下标来自它，不是 DOM 顺序
    expect(list).toMatch(/const ids = useMemo\(\(\) => items\.map\(\(item\) => item\.id\), \[items\]\)/);
    expect(list).toContain('items={ids}');
    expect(list).toContain('strategy={verticalListSortingStrategy}');
    // 被拖行会随窗口推进被卸载 → 拖拽视觉走常驻 DragOverlay，portal 到 body 免被 overflow 裁剪
    expect(list).toContain('<DragOverlay>');
    expect(list).toContain('createPortal(');
    expect(list).toContain('renderDragPreview');
    // 行高/阈值是共享口径，不另立一套
    expect(list).toContain('threshold = VIRTUALIZE_THRESHOLD');
    expect(stripComments(read('renderer/hooks/useVirtualRows.ts'))).toContain('export const VIRTUALIZE_THRESHOLD');
    expect(stripComments(read('renderer/components/SongList.tsx'))).not.toMatch(/const VIRTUALIZE_THRESHOLD/);
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
