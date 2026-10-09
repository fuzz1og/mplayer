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

describe('URL 编码归一的单一落点 = core 解析链出口（#622）', () => {
  it('⭐ core 里归一只有一份实现、一处调用，且调用点在解析链出口', () => {
    const files = coreSourceFiles(path.join(ROOT, 'packages', 'core', 'src'));
    const definition = files.filter((f) => /export function normalizeUrlEncoding/.test(codeOnly(f)));
    expect(definition.map((f) => path.relative(ROOT, f))).toEqual([
      path.join('packages', 'core', 'src', 'utils', 'urlEncoding.ts'),
    ]);

    const callers = files.filter((f) => !definition.includes(f) && /normalizeUrlEncoding\(/.test(codeOnly(f)));
    // 只允许解析链出口（sourceRouter）这一处；新增第二处 = 新增一份会漂的口径。
    expect(callers.map((f) => path.relative(ROOT, f))).toEqual([
      path.join('packages', 'core', 'src', 'shared', 'sourceRouter.ts'),
    ]);
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
