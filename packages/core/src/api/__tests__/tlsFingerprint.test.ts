import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getTlsFingerprintEnabled,
  setTlsFingerprintEnabled,
  loadTlsFingerprint,
  getTlsFingerprintHeaders,
  getTlsFingerprintConfig,
  setTlsFingerprintPersister,
  setTlsFingerprintAgentProvider,
  getTlsFingerprintAgent,
} from '../tlsFingerprint.js';

/**
 * T10 险情开关（spec #156）：TLS 指纹伪装，默认关，仅桌面，weapi 先行试点。
 * 接缝 = core `tlsFingerprint` 模块的状态 + 桌面 agent 提供者 + weapi 头/装配配置：
 * - 开关持久化（仿 T01 sourceRouter 的 persister 钩子，core 零 I/O）；
 * - 默认关，开启后 weapi 走指纹伪装（agent + 附加请求头）；
 * - 仅桌面：agent 提供者只由桌面 main 注入；未注入/RN 不产生任何行为变化。
 * 能力边界：Node 层无法伪造完整 JA3/JA4，此处为 best-effort 特征调整，
 * 承载"开关 + 接线 + 文档化边界"（验收以开关与接线为主）。
 */

beforeEach(() => {
  loadTlsFingerprint(false);
  setTlsFingerprintAgentProvider(null);
  setTlsFingerprintPersister(null);
});
afterEach(() => {
  loadTlsFingerprint(false);
  setTlsFingerprintAgentProvider(null);
  setTlsFingerprintPersister(null);
});

describe('TLS 指纹险情开关（T10 #156）', () => {
  it('默认关闭', () => {
    expect(getTlsFingerprintEnabled()).toBe(false);
  });

  it('开启 / 关闭可切换', () => {
    expect(getTlsFingerprintEnabled()).toBe(false);
    setTlsFingerprintEnabled(true);
    expect(getTlsFingerprintEnabled()).toBe(true);
    setTlsFingerprintEnabled(false);
    expect(getTlsFingerprintEnabled()).toBe(false);
  });

  it('开启时触发持久化：persister 收到 true；关闭收到 false', () => {
    const persisted: boolean[] = [];
    setTlsFingerprintPersister((v) => persisted.push(v));
    setTlsFingerprintEnabled(true);
    setTlsFingerprintEnabled(false);
    expect(persisted).toEqual([true, false]);
  });

  it('loadTlsFingerprint 重水合不触发持久化', () => {
    const persisted: boolean[] = [];
    setTlsFingerprintPersister((v) => persisted.push(v));
    loadTlsFingerprint(true);
    expect(getTlsFingerprintEnabled()).toBe(true);
    expect(persisted).toEqual([]);
  });

  it('开启后返回 weapi 附加指纹请求头；关闭时为空对象（默认行为不变）', () => {
    expect(getTlsFingerprintHeaders()).toEqual({});
    setTlsFingerprintEnabled(true);
    const headers = getTlsFingerprintHeaders();
    expect(headers['X-Requested-With']).toBe('com.netease.cloudmusic');
    expect(Object.keys(headers).length).toBeGreaterThan(0);
  });

  it('开启且注入桌面 agent 提供者可取到指纹 agent；关闭可清空', () => {
    expect(getTlsFingerprintAgent()).toBeNull();
    setTlsFingerprintAgentProvider(() => ({ fingerprint: true }));
    expect(getTlsFingerprintAgent()).toEqual({ fingerprint: true });
    setTlsFingerprintAgentProvider(null);
    expect(getTlsFingerprintAgent()).toBeNull();
  });

  it('开启时注入提供者的返回对象稳定（同一次调用取同一对象）', () => {
    const agent = { fingerprint: true };
    setTlsFingerprintAgentProvider(() => agent);
    expect(getTlsFingerprintAgent()).toBe(agent);
    expect(getTlsFingerprintAgent()).toBe(agent);
  });
});

describe('weapi 指纹装配配置（T10 配置函数单测）', () => {
  it('未开启：返回空配置（headers={}，无 agent），默认行为不变', () => {
    expect(getTlsFingerprintConfig()).toEqual({ headers: {}, httpsAgent: null });
  });

  it('开启且注入提供者：返回附加头 + 指纹 agent', () => {
    const agent = { ciphers: 'desktop-fingerprint' };
    setTlsFingerprintAgentProvider(() => agent);
    setTlsFingerprintEnabled(true);
    const cfg = getTlsFingerprintConfig();
    expect(cfg.httpsAgent).toBe(agent);
    expect(cfg.headers['X-Requested-With']).toBe('com.netease.cloudmusic');
  });

  it('开启但未注入提供者：只附加头，无 agent（移动端/未接线自然没有）', () => {
    setTlsFingerprintEnabled(true);
    const cfg = getTlsFingerprintConfig();
    expect(cfg.httpsAgent).toBeNull();
    expect(Object.keys(cfg.headers).length).toBeGreaterThan(0);
  });
});
