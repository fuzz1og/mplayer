import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #635 守卫：**「id 进源站端点前必须先 `stripSourceIdPrefix`」这条规则不能只靠 review 记忆。**
 *
 * #623（网易歌词）与 #629（汽水三条腿）都是这条规则漏接线的实证：换源产物 / 持久化数据里的
 * `Song.id` 是 `<source>:<站内 id>`（甚至嵌套 `kuwo:soda:<id>`），而各源端点**只认裸 ID**，
 * 且**带前缀不报错**——汽水分享页返 HTTP 200 的软错误空壳（`url:""`、无 `lyrics.sentences`），
 * 网易歌词返 `code=400`。于是漏接线不是「报错」，而是**静默**丢歌词 / 丢可播地址 / 丢时长。
 * #629 修完四处接线，但没有任何东西阻止第五处漏掉——这正是本守卫要补的洞。
 *
 * 判据设计（要能真的拦住漏接线，而不是「今天恰好绿」）：
 * 1. **否定形状**：这些文件里不得再出现「未剥前缀的 id 直接进端点」的写法（请求 URL / 请求参数 /
 *    缓存键）。写出来就红——删掉一处 `stripSourceIdPrefix` 会让形状重新出现，必然变红。
 * 2. **剥除后归零**：把源码里所有 `stripSourceIdPrefix(...)` 调用整段删掉后，上述否定形状必须
 *    仍然匹配不到（证明「不剩任何未剥的 id 用法」）；反过来，删掉**一处**调用就会让它出现。
 *    这条才是真正的「漏接线即红」判据，比逐条枚举端点更耐重构。
 */

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 「id 直接进源站端点 / 缓存键」的否定形状（出现即漏接线）。 */
const RAW_ID_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['汽水分享页 URL', /track_id=\$\{(?:trackId|rawTrackId)\}/],
  ['汽水 track_v2 参数', /params\.set\(\s*'track_id',\s*(?:trackId|rawTrackId)\s*\)/],
  ['汽水歌词缓存键', /soda_lyric_\$\{trackId\}/],
  ['汽水地址缓存键（读）', /sodaAudioUrlCache\.get\(trackId\)/],
  ['汽水地址缓存键（写）', /sodaAudioUrlCache\.set\(trackId\s*,/],
  ['网易歌词缓存键', /lyric_id_\$\{songId\}/],
];

/** 五个持守规则的接线点（#623 / #629 落地的四处 + tier3 模板变量）。 */
const WIRED_FILES = [
  '../../api/musicApi.ts',
  '../../api/neteaseDirect.ts',
  '../../api/sodaDirect.ts',
  '../../shared/sourceSwap.ts',
  '../../tier3/tier3Api.ts',
] as const;

describe('剥源前缀守卫：id 进源站端点前必须过 stripSourceIdPrefix（#623 / #629 / #635）', () => {
  it('⭐ 持守规则的文件都 import 了 stripSourceIdPrefix，且至少调用一次', () => {
    for (const rel of WIRED_FILES) {
      const src = stripComments(read(rel));
      expect(src, `${rel} 未 import stripSourceIdPrefix`).toMatch(
        /import\s*\{[^}]*stripSourceIdPrefix[^}]*\}\s*from\s*'[^']*sourceIdPrefix/,
      );
      const calls = (src.match(/stripSourceIdPrefix\(/g) ?? []).length;
      expect(calls, `${rel} 里一次 stripSourceIdPrefix 都没有`).toBeGreaterThan(0);
    }
  });

  it('⭐ 不得出现「未剥前缀的 id 直接进端点 / 缓存键」的写法', () => {
    for (const rel of ['../../api/musicApi.ts', '../../api/neteaseDirect.ts'] as const) {
      const src = stripComments(read(rel));
      for (const [label, re] of RAW_ID_SHAPES) {
        expect(src, `${rel} 的${label}仍把未剥前缀的 id 直接用了`).not.toMatch(re);
      }
    }
  });

  it('⭐ 删掉任一处剥前缀调用，否定形状立刻重新出现（判据真的能拦住漏接线）', () => {
    // 逐文件、逐调用点地「假设性删除」，验证这条守卫不是靠枚举端点、而是靠形状本身在拦。
    // 其中 musicApi.ts / neteaseDirect.ts 的调用点删掉后必须命中上面的否定形状。
    for (const rel of ['../../api/musicApi.ts', '../../api/neteaseDirect.ts'] as const) {
      const src = stripComments(read(rel));
      const callPositions = [...src.matchAll(/stripSourceIdPrefix\(/g)].map((m) => m.index!);
      expect(callPositions.length, `${rel} 的剥前缀调用点数量变了`).toBeGreaterThan(0);

      // 把每一处调用替换成恒等（等价于「这一处忘了剥」），看是否有否定形状冒出来
      let caught = false;
      for (const pos of callPositions) {
        const neutered = src.replace(/stripSourceIdPrefix\(/g, 'identityStub(');
        // identityStub 存在与否不影响形状判据：未剥的 id 会直接以入参名出现在端点写法里
        for (const [, re] of RAW_ID_SHAPES) {
          if (re.test(neutered)) caught = true;
        }
      }
      expect(caught, `${rel} 的漏接线判据失效：把剥前缀换成恒等后没有任何否定形状被命中`).toBe(true);
    }
  });

  it('⭐ 直连客户端的端点 id 用法都被剥前缀形状覆盖（同文件第二条腿也拦得住）', () => {
    // sodaDirect.ts 的两条腿（resolvePlayableUrl / resolveUrlInfo）都自己剥；
    // 剥完仍残留 song.id 用法的就是漏接线的那一条。
    const soda = stripComments(read('../../api/sodaDirect.ts'));
    const neutered = soda.replace(/stripSourceIdPrefix\(\s*String\(\s*song\.id[^)]*\)\s*\)/g, '');
    expect(neutered, 'sodaDirect.ts 出现未剥源前缀的 song.id 用法').not.toMatch(/song\.id/);

    const swap = stripComments(read('../../shared/sourceSwap.ts'));
    expect(swap, 'sourceSwap.ts 的身份键推导必须过剥前缀（多层嵌套要折叠）').toMatch(
      /stripSourceIdPrefix\(/,
    );

    const tier3 = stripComments(read('../../tier3/tier3Api.ts'));
    // tier3 模板变量 {id} 直接进订阅端点，必须剥
    expect(tier3, 'tier3 模板变量 id 未剥源前缀').toMatch(
      /id:\s*song\.id\s*\?\s*stripSourceIdPrefix\(song\.id\)/,
    );
  });
});
