import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NO_SELECTION,
  areAllSelected,
  deselectAll,
  enterSelection,
  pickSelected,
  selectAll,
  toggleSelection,
} from '../components/playlistSelection';

/** 读仓库内源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');
/** 源码断言去掉注释：注释里常**引用**被禁掉的旧写法，否则守卫会误伤自己 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ids = (s: string) => s.split(',').filter(Boolean);

/**
 * #490 选择模式：状态机是纯逻辑（node 可测），长按语义/一次写入/UI 落点用源码守卫钉住。
 */
describe('选择模式状态机（#490）', () => {
  it('长按进入模式并选中该行；再长按另一行是「并入」而不是切换/退出', () => {
    const one = enterSelection(NO_SELECTION, 'a');
    expect(one.mode).toBe(true);
    expect([...one.ids]).toEqual(['a']);

    const two = enterSelection(one, 'b');
    expect(two.mode).toBe(true);
    expect([...two.ids].sort()).toEqual(['a', 'b']);

    // 再长按已选中的行也是并入（票面：不退出模式），不会反选掉
    const again = enterSelection(two, 'a');
    expect([...again.ids].sort()).toEqual(['a', 'b']);
  });

  it('模式内的常规点击 = 切换选中，清空不退出（退出只认完成/取消全选）', () => {
    const start = selectAll(ids('a,b'));
    const off = toggleSelection(start, 'a');
    expect([...off.ids]).toEqual(['b']);
    expect(off.mode).toBe(true);

    const empty = toggleSelection(off, 'b');
    expect(empty.ids.size).toBe(0);
    expect(empty.mode).toBe(true);

    // 不在模式内时点击不产生选择（行点击只有在选择模式下才接管）
    const outside = toggleSelection(NO_SELECTION, 'a');
    expect(outside.mode).toBe(false);
    expect(outside.ids.size).toBe(0);
  });

  it('全选作用于传入的完整列表；取消全选清空但留在模式内', () => {
    const all = selectAll(ids('a,b,c'));
    expect(all.ids.size).toBe(3);
    expect(areAllSelected(all, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(true);

    const cleared = deselectAll();
    expect(cleared.mode).toBe(true);
    expect(cleared.ids.size).toBe(0);
    expect(areAllSelected(cleared, [{ id: 'a' }])).toBe(false);
  });

  it('areAllSelected 对空列表恒 false（不至于把「一首都没有」当成全选）', () => {
    expect(areAllSelected(selectAll([]), [])).toBe(false);
    expect(areAllSelected(NO_SELECTION, [{ id: 'a' }])).toBe(false);
    // 列表新增一首后「全选」不再成立（全选不是粘性开关）
    const all = selectAll(ids('a'));
    expect(areAllSelected(all, [{ id: 'a' }, { id: 'b' }])).toBe(false);
  });

  it('pickSelected 按列表顺序（不是点选顺序）取已选曲目', () => {
    const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    let sel = NO_SELECTION;
    sel = enterSelection(sel, 'c');
    sel = enterSelection(sel, 'a');
    expect(pickSelected(songs, sel).map((s) => s.id)).toEqual(['a', 'c']);
    // 陈旧 id（外部删歌）不会凭空出现在结果里
    expect(pickSelected(songs, selectAll(ids('a,ghost'))).map((s) => s.id)).toEqual(['a']);
  });

  it('每次变换都返回新集合，不改动入参（React 状态不可变）', () => {
    const base = enterSelection(NO_SELECTION, 'a');
    const baseIds = [...base.ids];
    toggleSelection(base, 'a');
    toggleSelection(base, 'b');
    enterSelection(base, 'b');
    expect([...base.ids]).toEqual(baseIds);
    expect(NO_SELECTION.ids.size).toBe(0);
    expect(NO_SELECTION.mode).toBe(false);
  });
});

describe('歌单页选择模式的接线（#490 源码守卫）', () => {
  it('长按 = 进入选择模式；旧的「长按 = 直接移除」已退休，但「更多」里仍能移除单曲', () => {
    const hero = stripComments(read('components/PlaylistHero.tsx'));
    expect(hero).toContain('onLongPress={() => onLongPressSong(item)}');
    expect(hero).not.toContain('onRemoveSong(item)');
    // 页面仍把 onRemove 传给行 → SongActionsHost 的「更多」菜单保留「移除」
    expect(hero).toMatch(/onRemove=\{onRemoveSong\}/);
  });

  it('顶部 sticky 条钉在悬浮导航栏正下方（不跟底部播放栏抢位置）', () => {
    const hero = read('components/PlaylistHero.tsx');
    expect(hero).toContain('PlaylistSelectionBar');
    expect(hero).toMatch(/insets\.top \+ NAV_H/);
    // 条与列表同树（由 Hero 渲染），页面只持有状态并把 selection 传下去
    expect(stripComments(read('app/playlist/[id].tsx'))).toContain('selection={selection}');
  });

  it('全选取 playlist.songs（完整列表），与 FlatList 的可见窗口无关', () => {
    const page = stripComments(read('app/playlist/[id].tsx'));
    expect(page).toMatch(/selectAll\(songs\.map\(\(s\) => s\.id\)\)/);
    expect(page).toMatch(/areAllSelected\(cur, songs\)/);
  });

  it('底部操作条紧贴 BottomSafePlayerBar 之前 → 两者上下相接不重叠', () => {
    const page = stripComments(read('app/playlist/[id].tsx'));
    const bar = page.indexOf('<PlaylistBatchBar');
    // 页面有两条 BottomSafePlayerBar（空壳早退分支 + 主分支），取主分支那一条
    const player = page.lastIndexOf('<BottomSafePlayerBar />');
    expect(bar).toBeGreaterThan(-1);
    expect(player).toBeGreaterThan(bar);
    // 选择模式只多挂一条普通流式子节点，不叠 absolute 覆盖播放栏
    expect(page).toMatch(/\{selection\.mode \? \(\s*<PlaylistBatchBar/);
  });

  it('批量操作各只触发一轮写入（批量腿，不逐首写库）', () => {
    const page = stripComments(read('app/playlist/[id].tsx'));
    expect(page).toContain('removeSongs(playlist.id, ids)');
    expect(page).toContain('addFavorites(selectedSongs)');
    // 「加入歌单」复用现成选择器的 songs 形态（组件内部一次 addSongs）
    expect(page).toContain('songs={addTargets ?? undefined}');
    // 逐首落库红线
    expect(page).not.toMatch(/removeSong\(playlist\.id, song/);
    expect(page).not.toMatch(/\.forEach\([^)]*addSong\(/);
  });

  it('入口有三：长按（挂在**行自身**）+ 英雄区「选择」+ ⋮ 面板「选择歌曲」', () => {
    const hero = stripComments(read('components/PlaylistHero.tsx'));
    const row = stripComments(read('components/SongRow.tsx'));
    // 长按必须挂在 SongRow 自身的 ScalePress 上：外层再包一层 Pressable 会被内层吞掉手势
    // （真机验收实测：外层写法下长按只会播放歌曲 → 批量模式不可达，2026-10-01 ADR 修订）
    expect(hero).not.toMatch(/<Pressable[\s\S]{0,120}onLongPress/);
    expect(hero).toMatch(/onLongPress=\{\(\) => onLongPressSong\(item\)\}/);
    expect(row).toMatch(/onLongPress=\{onLongPress\}/);
    // 可见入口：英雄区次级动作；选择模式内不渲染（入口让位给顶部条「完成」）
    expect(hero).toMatch(/secondaryActionLabel=\{selectionMode \? undefined : '选择'\}/);
    expect(hero).toContain('onSecondaryAction={onEnterSelection}');
    const page = stripComments(read('app/playlist/[id].tsx'));
    expect(page).toMatch(/onEnterSelection=\{handleEnterSelection\}/);
    // 显式入口进模式时**不预选**任何行（与桌面 SongList 的「批量管理」一致）
    expect(page).toMatch(/setSelection\(\{ mode: true, ids: new Set\(\) \}\)/);
    // 第三入口：⋮ 面板首项「选择歌曲」也走同一个 handleEnterSelection（先关面板再进模式）
    expect(page).toContain('选择歌曲');
    expect(page).toMatch(/setActionsVisible\(false\);\s*handleEnterSelection\(\)/);
  });

  it('Hero 次级动作与主按钮同款「两者都给才渲染」，不传的页面渲染不变', () => {
    const hero = stripComments(read('components/CollapsingHero.tsx'));
    expect(hero).toMatch(/secondaryActionLabel && onSecondaryAction \?/);
    // 贴左/上间距落在动作行上；主按钮把这两条移出去了（否则两处都写会叠加间距）
    expect(hero).toContain('styles.actionRow');
    expect(hero).toContain('marginTop: spacing[3]');
    expect(hero).not.toMatch(/playBtn: \{[^}]*marginTop/);
  });
});
