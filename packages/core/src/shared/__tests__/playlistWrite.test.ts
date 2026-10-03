import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  writeSongsToPlaylist,
  createPlaylistSnapshot,
  songWriteRejection,
  type PlaylistWriteDeps,
  type PlaylistSnapshot,
} from '../playlistWrite.js';
// 容量常量的唯一导出路径是 barrel 从 utils/songDedupe 直出（#556 评审 C 续）
import { DEFAULT_PLAYLIST_CAPACITY } from '../../utils/songDedupe.js';

const song = (id: string, name = `歌${id}`, artist = '歌手', sourceType: Song['sourceType'] = 'netease'): Song => ({
  id,
  name,
  artist,
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType,
});

/**
 * #554：fakeStore 的 addSongs **返回真实新增 id**（而不是 void）。
 *
 * 旧的 fake 返回 void，于是「added = 请求数」这个编造值与真实值在结构上不可分——
 * 删除测试（把 added 删掉，两端文案各退化成 songs.length）都能过。
 * 现在宿主回报真实结果，`added` 才有可能被证伪。
 */
function fakeStore(options: { capacity?: number } = {}) {
  const playlists = new Map<string, Song[]>();
  let seq = 0;
  const calls = { addSongs: 0, addSong: 0, create: 0, del: 0 };
  const deps: PlaylistWriteDeps = {
    addSongs: async (id, songs) => {
      calls.addSongs += 1;
      if (!playlists.has(String(id))) throw new Error('歌单不存在');
      const target = playlists.get(String(id))!;
      const have = new Set(target.map((s) => s.id));
      const fresh = songs.filter((s) => !have.has(s.id));
      target.push(...fresh);
      return fresh.length;
    },
    addSong: async (id, s) => {
      calls.addSong += 1;
      if (!playlists.has(String(id))) throw new Error('歌单不存在');
      const target = playlists.get(String(id))!;
      if (!target.some((x) => x.id === s.id)) target.push(s);
    },
    createPlaylist: async () => {
      calls.create += 1;
      const id = String(++seq);
      playlists.set(id, []);
      return id;
    },
    deletePlaylist: async (id) => {
      calls.del += 1;
      playlists.delete(String(id));
    },
    resolveNameConflict: async () => 'add',
  };
  const empty: PlaylistSnapshot = createPlaylistSnapshot({
    songs: [],
    capacity: options.capacity ?? DEFAULT_PLAYLIST_CAPACITY,
  });
  return { deps, calls, playlists, empty };
}

function snapshot(
  store: ReturnType<typeof fakeStore>,
  playlistId: string,
  capacity?: number,
): PlaylistSnapshot {
  return createPlaylistSnapshot({
    songs: store.playlists.get(playlistId) ?? [],
    capacity,
  });
}

/**
 * #542 / #553 / #554：歌单写入编排。
 *
 * 此前「往目标歌单写入一批歌」散在 8 处，各写各的回滚、去重与冲突口径；
 * 且 `PlaylistWriteResult.added` 填的是**请求数**（两条成功路径都写 `unique.length`），
 * 宿主的真实返回值被整个丢掉。这里把四类落点、回滚、容量截断与真值 added 一起钉死。
 */
describe('writeSongsToPlaylist（#542 歌单写入编排）', () => {
  it('已有歌单：整批写入一次（addSongs 优先，不逐首）', async () => {
    const store = fakeStore();
    store.playlists.set('1', []);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('a'), song('b')] },
      store.deps,
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(2);
    expect(store.calls.addSongs).toBe(1);
    expect(store.calls.addSong).toBe(0);
  });

  // #556 评审 B2：逐首腿此前无条件 added += 1——宿主说「没写进去」也照记。
  it('⭐ 逐首腿回报真实结果：宿主拒收的那首不计入 added', async () => {
    const store = fakeStore();
    store.playlists.set('1', []);
    let called = 0;
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('a'), song('b')] },
      {
        ...store.deps,
        addSongs: undefined,
        addSong: async (id, s) => {
          called += 1;
          if (s.id === 'b') return 0; // 宿主自己的判据/容量没收下
          store.playlists.get(String(id))!.push(s);
          return 1;
        },
      },
    );
    expect(called).toBe(2);
    expect(res.added).toBe(1); // 修前无条件 +1 → 2
    expect(res.invalid).toBe(1);
  });

  it('宿主没有 addSongs → 回落逐首，结果一致', async () => {
    const store = fakeStore();
    store.playlists.set('1', []);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('a'), song('b')] },
      { ...store.deps, addSongs: undefined },
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(2);
    expect(store.calls.addSong).toBe(2);
  });

  it('批内重复会被去掉并计入 skipped', async () => {
    const store = fakeStore();
    const res = await writeSongsToPlaylist(
      { createName: '新歌单', songs: [song('a'), song('a'), song('b')] },
      store.deps,
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(1);
    expect(store.calls.addSongs).toBe(1);
  });

  it('就地新建成功：返回 created=true 且不回滚', async () => {
    const store = fakeStore();
    const res = await writeSongsToPlaylist({ createName: '新歌单', songs: [song('a')] }, store.deps);
    expect(res).toMatchObject({ ok: true, created: true, rolledBack: false });
    expect(store.calls.create).toBe(1);
    expect(store.calls.del).toBe(0);
  });

  it('⭐ 就地新建后写入失败 → 删掉新建的空歌单（#493「失败不留空歌单」）', async () => {
    const store = fakeStore();
    const failing: PlaylistWriteDeps = {
      ...store.deps,
      addSongs: async () => {
        throw new Error('写入炸了');
      },
    };
    const res = await writeSongsToPlaylist({ createName: '新歌单', songs: [song('a')] }, failing);
    expect(res.ok).toBe(false);
    expect(res.created).toBe(true);
    expect(res.rolledBack).toBe(true);
    expect(store.calls.del).toBe(1);
    expect(store.playlists.size).toBe(0);
  });

  it('回滚也失败 → 如实上报 rolledBack=false（调用方知道有空歌单残留）', async () => {
    const store = fakeStore();
    const failing: PlaylistWriteDeps = {
      ...store.deps,
      addSongs: async () => {
        throw new Error('写入炸了');
      },
      deletePlaylist: async () => {
        throw new Error('删除也炸了');
      },
    };
    const res = await writeSongsToPlaylist({ createName: '新歌单', songs: [song('a')] }, failing);
    expect(res.ok).toBe(false);
    expect(res.rolledBack).toBe(false);
    expect(res.error).toContain('写入失败');
  });

  it('空批次 / 未指定目标 → 失败且不新建', async () => {
    const store = fakeStore();
    const empty = await writeSongsToPlaylist({ playlistId: '1', target: snapshot(store, '1'), songs: [] }, store.deps);
    expect(empty.ok).toBe(false);
    expect(store.calls.addSongs).toBe(0);

    const noTarget = await writeSongsToPlaylist({ songs: [song('a')] }, store.deps);
    expect(noTarget.ok).toBe(false);
    expect(noTarget.error).toBe('未指定目标歌单');
    expect(store.calls.create).toBe(0);
  });

  it('已有歌单写入失败 → 不回滚（那不是本次建的）', async () => {
    const store = fakeStore();
    store.playlists.set('1', []);
    const failing: PlaylistWriteDeps = {
      ...store.deps,
      addSongs: async () => {
        throw new Error('写入炸了');
      },
    };
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('a')] },
      failing,
    );
    expect(res.ok).toBe(false);
    expect(res.rolledBack).toBe(false);
    expect(store.calls.del).toBe(0);
    expect(store.playlists.has('1')).toBe(true);
  });
});

describe('四类落点（#553：new / duplicate / nameConflict / invalid 各一条用例）', () => {
  it('duplicate：判据命中的歌跳过且计入 skipped，宿主只收到 new', async () => {
    const store = fakeStore();
    store.playlists.set('1', [song('a', '晴天', '周杰伦')]);
    const res = await writeSongsToPlaylist(
      {
        playlistId: '1',
        target: snapshot(store, '1'),
        // b 是同一首（同源同名同歌手，id 变了）→ duplicate；c 是真新歌
        songs: [song('b', '晴天', '周杰伦'), song('c', '七里香', '周杰伦')],
      },
      store.deps,
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1);
    expect(store.calls.addSongs).toBe(1);
  });

  it('new：同源同名不同歌手不再被误判为已存在（旧判据会拒收）', async () => {
    const store = fakeStore();
    store.playlists.set('1', [song('a', '晚安', '张三')]);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('b', '晚安', '李四')] },
      store.deps,
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.duplicateNames).toBe(0);
  });

  it('nameConflict：异源同名同歌手由 resolveNameConflict 裁决（add = 并入）', async () => {
    const store = fakeStore();
    store.playlists.set('1', [song('a', '晴天', '周杰伦', 'netease')]);
    const seen: string[][] = [];
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('b', '晴天', '周杰伦', 'qq')] },
      {
        ...store.deps,
        resolveNameConflict: async (conflicts) => {
          seen.push(conflicts.map((c) => c.song.id));
          return 'add';
        },
      },
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(1);
    expect(res.duplicateNames).toBe(1);
    expect(seen).toEqual([['b']]); // 一次批量裁决，不是逐首回调
  });

  it('nameConflict：裁决为 skip 时不写入，并计入 skipped', async () => {
    const store = fakeStore();
    store.playlists.set('1', [song('a', '晴天', '周杰伦', 'netease')]);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('b', '晴天', '周杰伦', 'qq')] },
      { ...store.deps, resolveNameConflict: async () => 'skip' },
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.duplicateNames).toBe(1);
    expect(store.calls.addSongs).toBe(0); // 没有待写的歌就不打扰宿主
  });

  it('invalid：宿主判定数据不完整的歌不写、单独计数（不与重复混淆）', async () => {
    const store = fakeStore();
    store.playlists.set('1', []);
    const broken = { ...song('x'), name: '' };
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [broken, song('ok')] },
      store.deps,
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(1);
    expect(res.invalid).toBe(1);
    expect(res.skipped).toBe(0);
    expect(songWriteRejection(broken)).toBe('missing-fields');
    expect(songWriteRejection(song('ok'))).toBeNull();
  });

  // #556 评审 A4：旧行为是「没给回调 = 既不写入也不计数」——冲突歌凭空消失（缺省值撒谎）。
  it('⭐ nameConflict 且宿主未给裁决回调 → 默认并入：真的写进去，不静默丢弃', async () => {
    const store = fakeStore();
    store.playlists.set('1', [song('a', '晴天', '周杰伦', 'netease')]);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('b', '晴天', '周杰伦', 'qq')] },
      { ...store.deps, resolveNameConflict: undefined },
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(1); // 争议歌落到了宿主
    expect(res.skipped).toBe(0); // 不再「既不写入也不计数」
    expect(res.duplicateNames).toBe(1); // 冲突事实仍如实计数
  });

  it('全部落点都为空（全是重复）→ 仍算成功，added=0 且不写宿主', async () => {
    const store = fakeStore();
    store.playlists.set('1', [song('a', '晴天', '周杰伦')]);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('b', '晴天', '周杰伦')] },
      store.deps,
    );
    expect(res.ok).toBe(true);
    expect(res.added).toBe(0);
    expect(res.skipped).toBe(1);
    expect(store.calls.addSongs).toBe(0);
  });
});

describe('写入结果契约（#554：added 是真值、容量截断有显式通道）', () => {
  it('⭐ added 反映宿主真实新增数：宿主丢弃 1 首时 added=2，不是请求数 3', async () => {
    const store = fakeStore();
    store.playlists.set('1', []);
    const dropOne: PlaylistWriteDeps = {
      ...store.deps,
      // 宿主「静默丢弃」了一首（例如容量/校验）——旧的 added=unique.length 会报 3
      addSongs: async (id, songs) => {
        const kept = songs.slice(0, 2);
        store.playlists.get(String(id))!.push(...kept);
        return kept.length;
      },
    };
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1'), songs: [song('a'), song('b'), song('c')] },
      dropOne,
    );
    expect(res.added).toBe(2);
    expect(res.invalid).toBe(1); // 宿主没接纳的那 1 首如实归类，不丢
  });

  it('⭐ 容量截断有显式通道：truncated=true 且 requested/capacity 可读，不再静默', async () => {
    const store = fakeStore({ capacity: 2 });
    store.playlists.set('1', []);
    const res = await writeSongsToPlaylist(
      { playlistId: '1', target: snapshot(store, '1', 2), songs: [song('a'), song('b'), song('c')] },
      {
        ...store.deps,
        // 宿主按自己的容量上限截断（与 fileStorage.addSongsToPlaylist 的 1000 上限同形）
        addSongs: async (id, songs) => {
          const kept = songs.slice(0, 2);
          store.playlists.get(String(id))!.push(...kept);
          return kept.length;
        },
      },
    );
    expect(res.truncated).toBe(true);
    expect(res.added).toBe(2);
    expect(res.invalid).toBe(1);
    expect(res.capacity).toBe(2);
  });

  // #556 评审 B5：新建场景在「没有可写的歌」时先于新建分支返回 ok:true/created:false，
  // 调用点据此弹「已新建歌单…并添加 0 首」并关窗——歌单根本没建（违反 #551）。
  it('⭐ 新建歌单但一首都没写（全不合格）→ 失败，且不谎报「已新建」', async () => {
    const store = fakeStore();
    const broken = { ...song('x'), artist: '' };
    const res = await writeSongsToPlaylist({ createName: '新歌单', songs: [broken] }, store.deps);
    expect(res.ok).toBe(false);
    expect(res.created).toBe(false);
    expect(res.added).toBe(0);
    expect(res.error).toContain('未新建歌单');
    expect(store.calls.create).toBe(0); // 没有建出空歌单
    expect(store.playlists.size).toBe(0);
  });

  it('新歌单一首都没写进去 → 失败并回滚（不留空歌单）', async () => {
    const store = fakeStore();
    const res = await writeSongsToPlaylist(
      { createName: '新歌单', songs: [song('a')] },
      {
        ...store.deps,
        addSongs: async () => 0,
      },
    );
    expect(res.ok).toBe(false);
    expect(res.created).toBe(true);
    expect(res.rolledBack).toBe(true);
    expect(store.playlists.size).toBe(0);
  });
});

/** 读 core 源文件（vitest root = packages/core） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const readSource = (rel: string) => readFileSync(join(testDir, rel), 'utf8');
/** 源码断言必须去注释：注释里常常引用被删掉的旧写法 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * #556 评审 C 续：容量上限只允许一处。定义在 `utils/songDedupe`、由 barrel 直出；
 * `shared/playlistWrite` 此前同时转出它，成了第二条 re-export 路径（Duplicated/Middle Man）。
 */
describe('DEFAULT_PLAYLIST_CAPACITY 单条导出路径（#556 评审 C 续）', () => {
  it('playlistWrite 不再转出容量常量（中间人已删）', () => {
    expect(stripComments(readSource('../playlistWrite.ts'))).not.toContain('DEFAULT_PLAYLIST_CAPACITY');
  });

  it('公共出口仍从 utils/songDedupe 直出，不经 playlistWrite', () => {
    expect(stripComments(readSource('../../index.ts'))).toContain(
      "DEFAULT_PLAYLIST_CAPACITY } from './utils/songDedupe.js'",
    );
  });
});

