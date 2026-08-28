import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MUSIC_API_METHODS } from '@/shared/musicApiContract';

/**
 * 完整性测试（ADR-0001）：静态扫描把「music 域三份拷贝会漂移」收敛为测试期必现。
 * 校验：
 *  1. MUSIC_API_METHODS ⊆ core musicApi 方法（加方法漏登记 / 名字拼错 → 必报错）
 *  2. 渲染端无裸 `musicApi:*` 字符串（只允许 callMusicApi.ts 里的单通道 musicApi:call）
 *  3. src 全树无 `IpcMusicApi` / `ipcMusicApi` 引用（镜像代理已删除）
 *  4. 主进程 `musicApi:` 注册只有 `musicApi:call` 一处
 *  5. 分发表键集合 == MUSIC_API_METHODS ∪ MainOnlyMethods 键（每个键都有 handler）
 */

const ROOT = path.resolve(__dirname, '../..');

const SRC_RENDERER = path.join(ROOT, 'src', 'renderer');
const SRC_MAIN = path.join(ROOT, 'src', 'main');
const SRC_ALL = path.join(ROOT, 'src');
const CORE_MUSIC_API = path.join(ROOT, 'packages', 'core', 'src', 'api', 'musicApi.ts');
const DISPATCH_FILE = path.join(ROOT, 'src', 'main', 'ipc', 'musicApiHandlers.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 从 core musicApi 对象字面量中提取方法名 */
function coreMusicApiMethodNames(): Set<string> {
  const src = fs.readFileSync(CORE_MUSIC_API, 'utf8');
  const names = new Set<string>();
  // 匹配对象字面量成员名：`  async xxx(` / `  xxx:` / `  xxx(`
  // 或简写成员 `  xxx,`（如 groupIntoSongGroups）
  const re = /^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:\(|:|,)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (name === 'async' || name === 'return' || name === 'if' || name === 'const') continue;
    names.add(name);
  }
  return names;
}

function rendererSourceFiles(): string[] {
  return walk(SRC_RENDERER).filter((f) => !f.includes('__tests__'));
}

function allSourceFiles(): string[] {
  return walk(SRC_ALL).filter((f) => !f.includes('__tests__'));
}

/** 主进程 MainOnly 方法的键名（与 contract 的 MainOnlyMethods 一致）。 */
const MAIN_ONLY_METHODS = ['getAggregatedChart', 'getThrottleWait', 'getSodaPlayableUrl', 'resolvePlaylistLink'];

/** 从 musicApiHandlers.ts 的 `dispatch` 分发表提取方法名集合。 */
function dispatchMethodNames(): Set<string> {
  const src = fs.readFileSync(DISPATCH_FILE, 'utf8');
  const start = src.indexOf('const dispatch = {');
  if (start < 0) throw new Error('musicApiHandlers.ts 中找不到 const dispatch = {');
  const block = src.slice(start, src.indexOf('} satisfies', start));
  const names = new Set<string>();
  // 每个分发表成员行：`key: (...)` / `key: async (...)` / 简写 `key,`
  const re = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*(?:async\s*)?\(|,|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    names.add(m[1]);
  }
  return names;
}

describe('music 域 IPC 契约完整性（ADR-0001）', () => {
  it('MUSIC_API_METHODS 全在 core musicApi 上（core 加方法需登记此清单）', () => {
    const coreMethods = coreMusicApiMethodNames();
    const missing = MUSIC_API_METHODS.filter((name) => !coreMethods.has(name));
    expect(missing).toEqual([]);
  });

  it('分发表键集合 == MUSIC_API_METHODS ∪ MainOnlyMethods 键（每个键都有 handler）', () => {
    const dispatchKeys = dispatchMethodNames();
    const expected = [...MUSIC_API_METHODS, ...MAIN_ONLY_METHODS].sort();
    const missing = expected.filter((name) => !dispatchKeys.has(name));
    const extra = [...dispatchKeys].filter((name) => !expected.includes(name)).sort();
    // 每个键都有 handler（分发表里出现即接线）；缺失 / 多余都视为契约漂移。
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    expect(dispatchKeys.size).toBe(expected.length);
  });

  it('渲染端无裸 musicApi:* 字符串（只允许 callMusicApi.ts 的单通道）', () => {
    const offenders: string[] = [];
    for (const file of rendererSourceFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      const isCallEntry = rel.endsWith('callMusicApi.ts');
      for (const line of text.split('\n')) {
        const matches = line.match(/['"]musicApi:[a-zA-Z*][^'"]*['"]/g);
        if (!matches) continue;
        const bad = isCallEntry
          ? matches.filter((s) => s !== "'musicApi:call'" && s !== '"musicApi:call"')
          : matches;
        if (bad.length > 0) {
          offenders.push(`${rel}: ${bad.join(', ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src 全树无 IpcMusicApi / ipcMusicApi 引用（镜像代理已删除）', () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      if (/ipcMusicApi|IpcMusicApi/.test(text)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('主进程 musicApi: 注册只有 musicApi:call 一处', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_MAIN).filter((f) => !f.includes('__tests__'))) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      const matches = text.match(/['"]musicApi:[a-zA-Z*][^'"]*['"]/g) || [];
      const bad = matches.filter((s) => s !== "'musicApi:call'" && s !== '"musicApi:call"');
      if (bad.length > 0) offenders.push(`${rel}: ${bad.join(', ')}`);
    }
    // musicApi:call 注册必须恰好出现在 src/main 一处（musicApiHandlers.ts）
    const callSites = walk(SRC_MAIN)
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => /musicApi:call/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    expect(callSites).toHaveLength(1);
    expect(path.basename(callSites[0])).toBe('musicApiHandlers.ts');
  });
});
