import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  RENDERER_LOG_MAX,
  __resetRendererLogStore,
  clearRendererLogs,
  installRendererLogCapture,
  listRendererLogs,
} from '../services/rendererLogStore';
import { isDevMode, isDiagnosticsEnabled, setDevMode } from '../services/devMode';

/**
 * 桌面渲染层日志环形缓冲（#477）。桌面此前**没有任何**应用内日志缓冲
 * （wayfinder 基线原文「桌面没有对应物」），本票补的是一段全局 console 捕获 +
 * 读取入口，所以这里锁三件事：
 *   1. 捕获生效且**零调用点改动**（普通 `console.log` 即被收进缓冲）；
 *   2. 容量 = `RENDERER_LOG_MAX`（约 30 行）的环形截断；
 *   3. 门禁：`isDiagnosticsEnabled()` 关闭时不记（console 仍原样放行）。
 *
 * `import.meta.env.DEV` 由 Vite 内联；测试环境若把它当 dev 会盖掉门禁的负例，
 * 故用 `vi.stubEnv` 显式设成 false，让「开关」成为唯一变量。
 */

const logs = () => listRendererLogs();

/** 复位并重装捕获：让每条用例都从干净状态起步（真实入口只装一次）。 */
function reinstallCapture(): void {
  __resetRendererLogStore();
  installRendererLogCapture();
}

beforeEach(() => {
  vi.stubEnv('DEV', false);
  setDevMode(true);
  reinstallCapture();
});

afterEach(() => {
  setDevMode(false);
  reinstallCapture();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('rendererLogStore：全局 console 捕获', () => {
  it('普通 console.log / warn / error 被收进缓冲（零调用点改动）', () => {
    console.log('hello', 'world');
    console.warn('warned');
    console.error('boom');

    const list = logs();
    expect(list).toHaveLength(3);
    expect(list[0]!.message).toBe('hello world');
    expect(list[0]!.level).toBe('log');
    expect(list[1]!.level).toBe('warn');
    expect(list[2]!.level).toBe('error');
    expect(typeof list[0]!.ts).toBe('number');
  });

  it('Error 参数取栈、对象参数走 JSON', () => {
    console.error(new Error('kaput'));
    console.log({ a: 1 });
    expect(logs()[0]!.message).toContain('kaput');
    expect(logs()[1]!.message).toBe('{"a":1}');
  });

  it('安装时以当下的 console 方法为链底（透传到底层，不吞日志本身）', () => {
    // 注意时序：必须在 `install` **之前**替换 console.log，它才会成为包装链的底。
    // 重装是测试特有动作（真实入口只装一次），故先复位幂等标志。
    __resetRendererLogStore();
    const sink = vi.fn();
    (console as unknown as { log: (...a: unknown[]) => void }).log = sink;
    installRendererLogCapture();
    console.log('through wrapper');
    expect(sink).toHaveBeenCalledWith('through wrapper');
    expect(logs().map((e) => e.message)).toEqual(['through wrapper']);
  });
});

describe('rendererLogStore：环形容量与清空', () => {
  it('超过 RENDERER_LOG_MAX 只保留最近 N 条、丢最旧', () => {
    for (let i = 1; i <= RENDERER_LOG_MAX + 5; i++) console.log('m' + i);

    const list = logs();
    expect(list).toHaveLength(RENDERER_LOG_MAX);
    expect(list[0]!.message).toBe('m6');
    expect(list[RENDERER_LOG_MAX - 1]!.message).toBe('m' + (RENDERER_LOG_MAX + 5));
  });

  it('clearRendererLogs 清空缓冲；再次写入重新开始', () => {
    console.log('a');
    clearRendererLogs();
    expect(logs()).toHaveLength(0);
    console.log('b');
    expect(logs().map((e) => e.message)).toEqual(['b']);
  });

  it('installRendererLogCapture 幂等（重复调用不叠包装器）', () => {
    reinstallCapture();
    console.log('once');
    installRendererLogCapture();
    console.log('twice');
    expect(logs().map((e) => e.message)).toEqual(['once', 'twice']);
  });
});

describe('rendererLogStore：诊断门禁', () => {
  it('关闭开发者模式（非 dev 构建）时不记录，console 仍照常执行', () => {
    setDevMode(false);
    expect(isDevMode()).toBe(false);
    expect(isDiagnosticsEnabled()).toBe(false);

    console.log('should not be buffered');
    expect(logs()).toHaveLength(0);

    setDevMode(true);
    console.log('now buffered');
    expect(logs().map((e) => e.message)).toEqual(['now buffered']);
  });
});
