import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { useLogsStore } from '../stores/logsStore';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * logsStore 首份单测（#477）。此前 `entries` 零覆盖，而本票恰好给它加了级别门禁
 * （关 = normal 只记 warn/error，开 = verbose 记 info），所以这里锁三件事：
 *   1. `MAX_ENTRIES = 100` 环形截断；
 *   2. `notice`（用户可见 Toast）与 `entries`（诊断缓冲）**解耦**——
 *      info 不进缓冲时 Toast 也必须弹（否则「试听版可换源」会随日志级别被吞）；
 *   3. warn/error 不因级别门禁消失（release 侧看门狗与真实失败记录必须常开）。
 *
 * vitest 的 node 环境没有 `__DEV__`（RN 运行时才注入），故用 `vi.stubGlobal` 显式控制
 * `isDevBuild()`；用户开关走 `useSettingsStore.devMode`。
 */

const entries = () => useLogsStore.getState().entries;

beforeEach(() => {
  useLogsStore.getState().clearLogs();
  useLogsStore.getState().clearNotice();
  useSettingsStore.setState({ devMode: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('logsStore：环形缓冲截断', () => {
  it('MAX_ENTRIES = 100：超出后保留最近 100 条、丢最旧', () => {
    vi.stubGlobal('__DEV__', true); // 诊断开启 → info 也进缓冲
    for (let i = 1; i <= 105; i++) useLogsStore.getState().addLog('info', 'm' + i);

    const list = entries();
    expect(list).toHaveLength(100);
    expect(list[0]!.message).toBe('m6'); // 1–5 被挤出去
    expect(list[99]!.message).toBe('m105');
  });

  it('每条带 ts + level（面板按 level 着色/筛选）', () => {
    vi.stubGlobal('__DEV__', true);
    useLogsStore.getState().addLog('warn', 'w');
    expect(entries()[0]!.level).toBe('warn');
    expect(typeof entries()[0]!.ts).toBe('number');
  });
});

describe('logsStore：级别门禁只 gate 详细度', () => {
  it('关（normal）：info 不进缓冲，warn / error 照常进', () => {
    expect(useSettingsStore.getState().devMode).toBe(false);
    useLogsStore.getState().addLog('info', 'i');
    useLogsStore.getState().addLog('warn', 'w');
    useLogsStore.getState().addLog('error', 'e');

    const list = entries();
    expect(list.map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('开（verbose）：info 也进缓冲', () => {
    useSettingsStore.setState({ devMode: true });
    useLogsStore.getState().addLog('info', 'i');
    expect(entries().map((e) => e.level)).toEqual(['info']);
  });

  it('dev 构建等同 verbose（isDevBuild → isDiagnosticsEnabled）', () => {
    vi.stubGlobal('__DEV__', true);
    useLogsStore.getState().addLog('info', 'i');
    expect(entries()).toHaveLength(1);
  });
});

describe('logsStore：notice 与 entries 解耦（#477）', () => {
  it('关（normal）时 setNotice(info) 仍弹 Toast，只是不进缓冲', () => {
    useLogsStore.getState().setNotice('info', '当前为试听版，可换源获取完整版');

    expect(useLogsStore.getState().notice).toEqual({
      level: 'info',
      text: '当前为试听版，可换源获取完整版',
    });
    expect(entries()).toHaveLength(0);
  });

  it('开（verbose）时 setNotice(info) 同时进缓冲与 Toast', () => {
    useSettingsStore.setState({ devMode: true });
    useLogsStore.getState().setNotice('info', '试听版');

    expect(useLogsStore.getState().notice).toEqual({ level: 'info', text: '试听版' });
    expect(entries()).toHaveLength(1);
  });

  it('reportError 在任何级别下都同时进缓冲与 Toast', () => {
    useLogsStore.getState().reportError('播放失败');

    expect(useLogsStore.getState().notice).toEqual({ level: 'error', text: '播放失败' });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]!.level).toBe('error');
  });

  it('clearLogs 只清缓冲，不动 Toast（用户可见提示不该被「清空日志」吞掉）', () => {
    useLogsStore.getState().setNotice('info', '试听版');
    useLogsStore.getState().clearLogs();

    expect(entries()).toHaveLength(0);
    expect(useLogsStore.getState().notice).not.toBeNull();
  });
});
