import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createNeteaseAnonymousCookie,
  createNeteaseBorrowMusicUCookie,
  createKugouDeviceCookie,
  shouldRotateCookie,
  generateCookie,
  getCookie,
  setCookie,
  refreshCookie,
  ensureFreshCookie,
  clearCookie,
  loadCookies,
  setCookiePersister,
  getBorrowMusicUEnabled,
  setBorrowMusicUEnabled,
  MANAGE_COOKIE_TTL_MS,
  KUGOU_COOKIE_TTL_MS,
} from '../cookieManager.js';

/**
 * T13 spec #159 轻量 cookie 管理器（spec #146 决策 5 / #126/#130）。
 *
 * 接缝 = core `cookieManager` 的纯函数生成器 + 内存态管理器：
 * - 生成逻辑全部纯函数可测（网易匿名策略 / MUSIC_U 借用开关默认关 / 酷狗设备 cookie）；
 * - 内存管理器零 I/O（任意环境可直接用 = 移动端内存态）；宿主注册 persister 落盘（桌面）；
 * - 提供统一接口：generate / get / set / refresh / ensureFresh / clear / rotate 判定。
 * - 冷启动加载 `loadCookies` 不触发持久化；变更操作触发。
 */

const FIXED_NOW = Date.parse('2024-06-01T00:00:00.000Z');
const clock = () => FIXED_NOW;

beforeEach(() => {
  clearCookie('netease');
  clearCookie('kugou');
  setCookiePersister(null);
  setBorrowMusicUEnabled(false);
});
afterEach(() => {
  clearCookie('netease');
  clearCookie('kugou');
  setCookiePersister(null);
  setBorrowMusicUEnabled(false);
});

describe('生成：网易匿名 cookie（纯函数）', () => {
  it('默认纯匿名：value 为空串，不携带任何用户凭据', () => {
    const c = createNeteaseAnonymousCookie(clock);
    expect(c.source).toBe('netease');
    expect(c.value).toBe('');
    expect(c.generatedAt).toBe('2024-06-01T00:00:00.000Z');
    expect(Date.parse(c.expiresAt)).toBeGreaterThan(FIXED_NOW);
    // 匿名策略：显式标记无用户凭据，供上层判断「纯匿名可直连」
    expect(c.metadata?.['anonymous']).toBe(true);
  });

  it('生成时应带合理的有效期（缺省 TTL），轮换按 TTL 判定', () => {
    const c = createNeteaseAnonymousCookie(clock);
    const ttl = Date.parse(c.expiresAt) - Date.parse(c.generatedAt);
    expect(ttl).toBe(MANAGE_COOKIE_TTL_MS);
  });
});

describe('生成：网易 MUSIC_U 借用（内部开关，默认关）', () => {
  it('借用开关默认关闭', () => {
    expect(getBorrowMusicUEnabled()).toBe(false);
  });

  it('开启后可生成带 MUSIC_U 的 cookie（借用凭据提升音质/VIP 检测）', () => {
    const c = createNeteaseBorrowMusicUCookie('MUSIC_U_abc123', clock);
    expect(c.source).toBe('netease');
    expect(c.value).toMatch(/^MUSIC_U=.*MUSIC_U_abc123/);
    expect(c.metadata?.['anonymous']).toBe(false);
  });
});

describe('生成：酷狗设备 cookie（供 T07 消费，纯函数）', () => {
  const reg = {
    guid: 'GUID-1',
    mid: 'MID-1',
    mac: 'aabbccddeeff',
    dev: 'DEV-1',
    dfid: 'DFID-1',
  };

  it('由设备注册参数生成 KV cookie 串', () => {
    const c = createKugouDeviceCookie(reg, clock);
    expect(c.source).toBe('kugou');
    expect(c.value).toContain('KUGOU_API_GUID=GUID-1');
    expect(c.value).toContain('KUGOU_API_MID=MID-1');
    expect(c.value).toContain('KUGOU_API_MAC=aabbccddeeff');
    expect(c.value).toContain('KUGOU_API_DEV=DEV-1');
    expect(c.value).toContain('dfid=DFID-1');
    expect(c.metadata?.['anonymous']).toBe(true);
  });

  it('酷狗设备 cookie 缺省 TTL 独立（可配置/轮换）', () => {
    const c = createKugouDeviceCookie(reg, clock);
    const ttl = Date.parse(c.expiresAt) - Date.parse(c.generatedAt);
    expect(ttl).toBe(KUGOU_COOKIE_TTL_MS);
  });
});

describe('轮换判定（纯函数）', () => {
  it('未过期不轮换；已过期应轮换', () => {
    const c = createNeteaseAnonymousCookie(clock);
    expect(shouldRotateCookie(c, () => FIXED_NOW + 1000)).toBe(false);
    // 超过 expiresAt 即应轮换
    expect(shouldRotateCookie(c, () => Date.parse(c.expiresAt) + 1)).toBe(true);
  });

  it('空/无 cookie 视为应轮换（无凭据时重新生成）', () => {
    expect(shouldRotateCookie(null as never, clock)).toBe(true);
  });
});

describe('统一接口：内存态管理器（无 I/O，默认即移动端内存态）', () => {
  it('generateCookie 未生成前 getCookie 返回 undefined；生成后可取到', () => {
    expect(getCookie('netease')).toBeUndefined();
    generateCookie('netease', { clock });
    const c = getCookie('netease');
    expect(c).toBeTruthy();
    expect(c!.source).toBe('netease');
    expect(c!.value).toBe('');
  });

  it('generateCookie 网易默认纯匿名；开启借用开关后产出 MUSIC_U cookie', () => {
    setBorrowMusicUEnabled(true);
    generateCookie('netease', { clock, borrowMusicU: 'MUSIC_U_xyz' });
    // 开启借用开关后管理器生成带 MUSIC_U 的 cookie
    const stored = getCookie('netease');
    expect(stored!.value).toMatch(/^MUSIC_U=/);
  });

  it('ensureFreshCookie：未过期返回原 cookie，不重新生成（不触发不必要轮换）', () => {
    const first = generateCookie('kugou', { clock, kugouReg: { guid: 'g', mid: 'm', mac: 'x', dev: 'd', dfid: 'f' } });
    const genAt = getCookie('kugou')!.generatedAt;
    const fresh = ensureFreshCookie('kugou', { clock });
    expect(fresh).toBe(first);
    expect(fresh!.generatedAt).toBe(genAt);
  });

  it('ensureFreshCookie：已过期自动轮换出新 cookie', () => {
    generateCookie('kugou', { clock, kugouReg: { guid: 'g1', mid: 'm1', mac: 'x', dev: 'd', dfid: 'f1' } });
    // 过期再 ensureFresh → 重新生成（generatedAt 变化）
    const fresh = ensureFreshCookie('kugou', { clock: () => FIXED_NOW + KUGOU_COOKIE_TTL_MS + 1000, kugouReg: { guid: 'g2', mid: 'm2', mac: 'y', dev: 'd2', dfid: 'f2' } });
    expect(fresh!.metadata?.['guid']).toBe('g2');
  });

  it('refreshCookie 强制轮换：同源每次生成新 cookie，generatedAt 更新', () => {
    const a = refreshCookie('netease', { clock });
    const b = refreshCookie('netease', { clock: () => FIXED_NOW + 5000 });
    expect(b!.generatedAt).toBe('2024-06-01T00:00:05.000Z');
    expect(b!.generatedAt).not.toBe(a!.generatedAt);
  });

  it('setCookie 可手动注入；clearCookie 清空', () => {
    setCookie(createNeteaseAnonymousCookie(clock));
    expect(getCookie('netease')).toBeTruthy();
    clearCookie('netease');
    expect(getCookie('netease')).toBeUndefined();
  });
});

describe('统一接口：持久化钩子（桌面宿主落盘，core 零 I/O）', () => {
  it('generate/refresh/set 触发 persister；loadCookies 重水合不触发', () => {
    const persisted: string[] = [];
    setCookiePersister((c) => persisted.push(c.value));
    generateCookie('netease', { clock });
    clearCookie('netease');
    expect(persisted).toHaveLength(2); // generate + clear(空串落盘)

    // 重水合不触发（用纯函数预构建 cookie，不走 generateCookie 的持久化路径）
    persisted.length = 0;
    loadCookies([createKugouDeviceCookie({ guid: 'g', mid: 'm', mac: 'x', dev: 'd', dfid: 'f' }, clock)]);
    expect(persisted).toHaveLength(0);
    expect(getCookie('kugou')).toBeTruthy();
  });
});
