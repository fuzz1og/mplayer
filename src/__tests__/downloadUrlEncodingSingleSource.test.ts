import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * #622 守卫：URL 编码归一只有一个落点——core 播放解析链的出口 `resolveRoutedInner`。
 *
 * 汽水 CDN 直链带未编码的 `|`（实测 `...&cd=0|0|0|5&...`），`java.net.URI` 判它非法，
 * 移动端 `File.downloadFileAsync` 在原生层抛转换失败。修法是「取 URL 的单一落点归一」，
 * 不是「每个下载调用点各补一遍」——补在调用点就会有两份口径，迟早漂（#608 取词决策同款事故）。
 *
 * 于是这里钉三件事：
 * 1. core 里 `normalizeUrlEncoding` 的实现一份、调用点**恰好一处**，且就在解析链出口；
 * 2. 两条下载链都只从那个出口取 URL（桌面不得再留 `getSodaAudioUrl` 这种旁路）；
 * 3. 任何宿主侧文件不得自带补码（`%7C` / `encodeURI` / `replace(/\|/…)`）——那是第二处归一。
 *
 * **#635 收紧**：第 1 条原先是「文件列表」粒度，在同一文件内按腿各调一次仍全绿。现在改成
 * **数调用点**，同文件第二条腿也会红。
 *
 * **#635 另修一处 + 明确一处不修**：曾一度把 `normalizeUrlEncoding` 补进汽水「生产者」
 * `musicApi.getSodaAudioUrl`（含缓存命中返回的 `cached.url`）——但 ADR 的否决表**明确否掉**
 * 「补在汽水 URL 的生产者」，且那版只归一了新解析路径、缓存命中仍漏 `|`（评审实证）。
 * 现按 ADR 归位：归一只在 core 出口一处；桌面 IPC 缓存腿 `getSodaPlayableUrl` 不经出口、
 * 拿到未归一裸直链，是 ADR 后果 1 记录的**已知边界**（Node/axios 栈自己转义，不走
 * `java.net.URI` 原生解析），宿主侧不得为其补码（第 3 条）。
 */
const ROOT = path.resolve(__dirname, '../..');

/** 注释里可以谈口径，代码里不可以：判据只看剥掉注释后的源码。 */
function codeOnly(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** core 生产代码（测试目录不算——测试里的引用是断言，不是第二处归一）。 */
function coreSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...coreSourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 宿主侧取 URL 交给下载/播放目标的三条链（移动端两条 + 桌面主进程一条）。 */
const DOWNLOAD_CONSUMERS = [
  ['移动端下载', path.join(ROOT, 'packages', 'mobile', 'services', 'downloadService.ts')],
  ['移动端解析出口', path.join(ROOT, 'packages', 'mobile', 'services', 'songResolution.ts')],
  ['桌面下载', path.join(ROOT, 'src', 'main', 'services', 'downloadService.ts')],
] as const;

/** 归一自身的实现形状：宿主侧出现任一形状就是「第二处归一」。 */
const LOCAL_NORMALIZATION = [/normalizeUrlEncoding/, /encodeURI/, /%7C/];

/**
 * 按大括号配对切出方法体（签名定位定义处，不依赖缩进与局部变量名——后者会随重构漂移）。
 * 与 `src/__tests__/main/syncIoDiscipline.test.ts` 同一手法：钉结构，不钉写法。
 */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `源码里找不到 ${signature}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`无法切出 ${signature} 的方法体`);
}

/**
 * 允许的 `normalizeUrlEncoding(` 调用点全集：**只有** `shared/sourceRouter.ts` 一处
 * （解析链唯一出口，#622 决策 2）。新增任何一处都必须先在这里登记并写清理由——
 * 否则就是第二份会漂的归一。
 */
const ALLOWED_CALL_SITES: ReadonlyArray<readonly [string, number]> = [
  [path.join('packages', 'core', 'src', 'shared', 'sourceRouter.ts'), 1],
];

describe('URL 编码归一的单一落点 = core 解析链出口（#622）', () => {
  it('⭐ core 里归一只有一份实现、调用点恰好一处（同文件多处也拦得住），且在解析链出口', () => {
    const files = coreSourceFiles(path.join(ROOT, 'packages', 'core', 'src'));
    const definition = files.filter((f) => /export function normalizeUrlEncoding/.test(codeOnly(f)));
    expect(definition.map((f) => path.relative(ROOT, f))).toEqual([
      path.join('packages', 'core', 'src', 'utils', 'urlEncoding.ts'),
    ]);

    // 按**调用点**数，不按文件数（#635）：同文件第二条腿漏归一，旧判据看不见。
    const callSites: Array<{ file: string; count: number }> = [];
    for (const f of files) {
      if (definition.includes(f)) continue;
      const count = (codeOnly(f).match(/normalizeUrlEncoding\(/g) ?? []).length;
      if (count > 0) callSites.push({ file: path.relative(ROOT, f), count });
    }

    const actual = callSites.map((c) => [c.file, c.count] as const).sort();
    const expected = [...ALLOWED_CALL_SITES].sort();
    expect(actual, 'normalizeUrlEncoding 调用点与登记表不符（新增一处必须先在 ALLOWED_CALL_SITES 登记理由）').toEqual(expected);
  });

  it('⭐ 汽水生产者 getSodaAudioUrl 不补码（补码被 ADR 否决表否掉，只在出口做一次）', () => {
    // ADR 否决表明确否掉「补在汽水 URL 的生产者」——补在这里既违反单点，又只归一新解析路径、
    // 缓存命中返回的 cached.url 仍漏 `|`（#635 评审实证）。故生产者保持返回**未归一**裸直链
    // （与其余源 resolveUrlInfo 同形），归一只在 core 出口；桌面 IPC 腿是已知边界，不为其补码。
    const soda = codeOnly(path.join(ROOT, 'packages', 'core', 'src', 'api', 'musicApi.ts'));
    const body = methodBody(soda, 'async getSodaAudioUrl(');
    expect(body, '汽水生产者又被塞进补码了——ADR 否决表否掉这条路，请走 core 出口').not.toMatch(
      /normalizeUrlEncoding\(/,
    );
    // 缓存命中返回的是裸 cached.url（未经归一）：这正是「生产者不补码」的落点，也说明
    // 桌面 IPC 腿拿到的是未归一直链这一已知边界。
    expect(body).toMatch(/return\s+cached\.url/);
  });

  it('⭐ 同文件第二处调用点也能被拦住（旧判据只看文件列表，看不见它）', () => {
    // 这条钉「判据本身」：在 sourceRouter.ts 里再加一处调用点，数调用点必须变红。
    const router = codeOnly(path.join(ROOT, 'packages', 'core', 'src', 'shared', 'sourceRouter.ts'));
    const count = (router.match(/normalizeUrlEncoding\(/g) ?? []).length;
    expect(count, 'sourceRouter.ts 的归一调用点数量变了——新增腿请走同一处出口，而不是各调一次').toBe(1);
  });

  it('两条下载链都从解析出口取 URL，桌面不再留汽水直连旁路', () => {
    const mobile = codeOnly(path.join(ROOT, 'packages', 'mobile', 'services', 'downloadService.ts'));
    expect(mobile, '移动端下载未消费解析出口 resolvePlayableUrlMobile').toMatch(/resolvePlayableUrlMobile\(/);

    const desktop = codeOnly(path.join(ROOT, 'src', 'main', 'services', 'downloadService.ts'));
    expect(desktop, '桌面下载未消费解析出口 resolvePlayableSongRouted').toMatch(/resolvePlayableSongRouted\(/);
    // getSodaAudioUrl 是汽水直连腿的本体：下载链自己调它 = 绕开出口另取一份 URL。
    expect(desktop, '桌面下载仍自留 getSodaAudioUrl 旁路（绕开 #622 的单一归一）').not.toMatch(/getSodaAudioUrl\(/);
  });

  it('宿主侧不得自带补码（那会是第二处归一）', () => {
    for (const [label, file] of DOWNLOAD_CONSUMERS) {
      const src = codeOnly(file);
      for (const re of LOCAL_NORMALIZATION) {
        expect(src, `${label} 自带归一形状 ${re}`).not.toMatch(re);
      }
    }
  });
});
