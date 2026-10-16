import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #635 守卫：「id 进源站端点前必须先 `stripSourceIdPrefix`」不能只靠 review 记忆。#623（网易歌词）与 #629（汽水三条腿）都是漏接线的实证——
 * `Song.id` 是 `<source>:<站内 id>`（甚至嵌套），各源端点**只认裸 ID**且**带前缀不报错**（汽水返 200 软错误空壳、网易返 `code=400`），
 * 漏接线是**静默**丢歌词/地址/时长。判据两层：① 端点写法不得直接用入参名（`trackId`/`songId` 原值进 URL/参数/缓存键）；② 端点里用的 `raw*` 局部量必须来自一次 `stripSourceIdPrefix(...)`。
 */

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 第 1 层：入参名直接进端点 / 缓存键（出现即漏剥）。 */
const RAW_ID_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['汽水分享页 URL', /track_id=\$\{trackId\}/],
  ['汽水 track_v2 参数', /params\.set\(\s*'track_id',\s*trackId\s*\)/],
  ['汽水歌词缓存键', /soda_lyric_\$\{trackId\}/],
  ['汽水地址缓存键（读）', /sodaAudioUrlCache\.get\(trackId\)/],
  ['汽水地址缓存键（写）', /sodaAudioUrlCache\.set\(trackId\s*,/],
  ['网易歌词缓存键', /lyric_id_\$\{songId\}/],
];

/**
 * 第 2 层的登记表：`[文件, 局部量名, 该局部量的正确声明]`。
 *
 * 「正确声明」写成完整正则而不是只写名字：局部量叫什么不重要，重要的是它由剥前缀产生。
 * 新增一处接线要在这里登记（同时说明为什么那一处需要剥）——这正是本守卫的价值。
 */
const STRIPPED_LOCALS: ReadonlyArray<readonly [string, string, RegExp]> = [
  ['../../api/musicApi.ts', 'rawTrackId', /const rawTrackId = stripSourceIdPrefix\(String\(trackId(?: \?\? '')?\)\);/],
  ['../../api/neteaseDirect.ts', 'rawId', /const rawId = stripSourceIdPrefix\(String\(songId\)\);/],
];

describe('剥源前缀守卫：id 进源站端点前必须过 stripSourceIdPrefix（#623 / #629 / #635）', () => {
  it('⭐ 持守规则的文件都 import 了 stripSourceIdPrefix，且至少调用一次', () => {
    for (const rel of [
      '../../api/musicApi.ts',
      '../../api/neteaseDirect.ts',
      '../../api/sodaDirect.ts',
      '../../shared/sourceSwap.ts',
      '../../tier3/tier3Api.ts',
    ] as const) {
      const src = stripComments(read(rel));
      expect(src, `${rel} 未 import stripSourceIdPrefix`).toMatch(
        /import\s*\{[^}]*stripSourceIdPrefix[^}]*\}\s*from\s*'[^']*sourceIdPrefix/,
      );
      expect((src.match(/stripSourceIdPrefix\(/g) ?? []).length, `${rel} 里一次调用都没有`).toBeGreaterThan(0);
    }
  });

  it('⭐ 端点与缓存键不得直接用未剥前缀的入参名（第 1 层：直接漏剥）', () => {
    for (const rel of ['../../api/musicApi.ts', '../../api/neteaseDirect.ts'] as const) {
      const src = stripComments(read(rel));
      for (const [label, re] of RAW_ID_SHAPES) {
        expect(src, `${rel} 的${label}仍把未剥前缀的 id 直接用了`).not.toMatch(re);
      }
    }
  });

  it('⭐ 端点用到的 raw* 局部量必须由 stripSourceIdPrefix 产生（第 2 层：删掉调用就红）', () => {
    for (const [rel, local, declaration] of STRIPPED_LOCALS) {
      const src = stripComments(read(rel));
      expect(src, `${rel} 里找不到 ${local} 的剥前缀声明（形状漂了，请同步 STRIPPED_LOCALS）`).toMatch(declaration);
      // 该局部量确实被端点/缓存键消费——否则这条登记就是死项
      expect(src, `${rel} 里 ${local} 没有被任何端点/缓存键使用`).toMatch(new RegExp(`\\$\\{${local}\\}|\\b${local}\\b`));
    }
  });

  it('⭐ 判据自检：把剥前缀换成恒等后，第 2 层必须抓到（不是「今天恰好绿」）', () => {
    // 证的是**判据本身**：`const rawId = stripSourceIdPrefix(String(songId))` → `const rawId = songId`
    // （= 这一处忘了剥）之后，端点写法没变、但局部量的声明不再是剥前缀 → 上面的第 2 条会红。
    for (const [rel, , declaration] of STRIPPED_LOCALS) {
      const src = stripComments(read(rel));
      const neutered = src.replace(/stripSourceIdPrefix\(String\(([^)]+)\)\)/g, '$1');
      expect(neutered, '恒等替换没生效（剥前缀的写法形状漂了，请同步本守卫）').not.toBe(src);
      expect(neutered, `${rel} 漏接线判据失效：换成恒等后第 2 层仍然放行`).not.toMatch(declaration);
    }
  });

  it('⭐ 直连客户端与身份推导侧也各自过剥前缀（同文件多条腿都拦得住）', () => {
    // sodaDirect.ts 的两条腿（resolvePlayableUrl / resolveUrlInfo）都自己剥；
    // 把剥前缀抹平后仍残留 song.id 用法，就是漏接线的那一条腿。
    const soda = stripComments(read('../../api/sodaDirect.ts'));
    const neutered = soda.replace(/stripSourceIdPrefix\(\s*String\(\s*song\.id[^)]*\)\s*\)/g, '');
    expect(neutered, 'sodaDirect.ts 出现未剥源前缀的 song.id 用法').not.toMatch(/song\.id/);

    // 身份键推导必须过剥前缀（多层嵌套要折叠成一个身份，否则同一首歌两个键）
    expect(stripComments(read('../../shared/sourceSwap.ts')), 'sourceSwap.ts 的身份键推导必须过剥前缀').toMatch(
      /stripSourceIdPrefix\(/,
    );

    // tier3 模板变量 {id} 直接进订阅端点，必须剥
    expect(stripComments(read('../../tier3/tier3Api.ts')), 'tier3 模板变量 id 未剥源前缀').toMatch(
      /id:\s*song\.id\s*\?\s*stripSourceIdPrefix\(song\.id\)/,
    );
  });
});
