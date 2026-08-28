import { describe, it, expect } from 'vitest';
import * as core from '../../index.js';

/**
 * #276 出口归零断言：自建 API 机件（api 客户端/会话引导/cookie 管理/请求
 * 拦截器/并发闸门/WebView 桥/耗时计时/限流观察器/音频地址缓存）删除后，
 * core 公共出口不得再出现这些符号；歌词门面与代理注入接口出口保留。
 */
const REMOVED_EXPORTS = [
  'setApiBaseUrl',
  'getApiBaseUrl',
  'getApiClient',
  'setApiRequestHandler',
  'setApiTimingLog',
  'setThrottleObserver',
  'markApiSessionBootstrapped',
  'setApiSessionCookieValue',
  'getApiSessionCookie',
  'isApiOriginUrl',
  'warmUpArtistPicCache',
  'injectProxyAgents',
] as const;

describe('core 出口归零（#276 自建 API 机件清除）', () => {
  it('已删机件符号不再出现在 core 公共出口', () => {
    const leak = REMOVED_EXPORTS.filter(
      (name) => (core as Record<string, unknown>)[name] !== undefined,
    );
    expect(leak).toEqual([]);
  });

  it('歌词门面 / 代理注入接口 / 歌词归一化出口保留', () => {
    expect(core.musicApi).toBeDefined();
    expect(typeof core.musicApi.getLyrics).toBe('function');
    expect(typeof core.setProxyUrl).toBe('function');
    expect(typeof core.getProxyUrl).toBe('function');
    expect(typeof core.decodeLyricBody).toBe('function');
  });
});
