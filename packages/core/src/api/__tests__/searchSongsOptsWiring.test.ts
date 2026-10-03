import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setTransport } from '../transport.js';
import { kugouDirectClient } from '../kugouDirect.js';
import { kuwoDirectClient } from '../kuwoDirect.js';
import { miguDirectClient } from '../miguDirect.js';
import { qianqianDirectClient } from '../qianqianDirect.js';
import { qqDirectClient } from '../qqDirect.js';
import { sodaDirectClient } from '../sodaDirect.js';
import { createNeteaseDirectClient } from '../neteaseDirect.js';
import type { DirectSourceClient } from '../../shared/sourceRouter.js';

/**
 * #556 评审 A1：链尾搜索腿的墙钟与取消信号**真的**接进了每个直连源。
 *
 * 修前形态：`LegOptions` / `searchSongsRouted` 的第 4 参 / `DirectSourceClient.searchSongs`
 * 的第 3 参都在，7 个直连源的实现却全是 `(keyword, page)` —— 参数只有测试里的 fake 读，
 * 产线零消费者。「搜索腿纳入预算」于是只对 fake 生效：#556 的预算墙对真实上游是空话。
 *
 * 这里用 transport 接缝（`setTransport`）从**每个源的外部行为**上钉住透传：
 * 搜索路径上的每一次出网请求都必须带上这次调用的 `timeoutMs` 与 `signal`。
 * 修前 7 个源全部是「源自己的固定 8000/15000 + 无 signal」→ 红。
 */
const CLIENTS: ReadonlyArray<[string, DirectSourceClient]> = [
  ['netease', createNeteaseDirectClient()],
  ['qq', qqDirectClient],
  ['kugou', kugouDirectClient],
  ['migu', miguDirectClient],
  ['kuwo', kuwoDirectClient],
  ['qianqian', qianqianDirectClient],
  ['soda', sodaDirectClient],
];

describe('#556 评审 A1：每个直连源的 searchSongs 把 opts 接进 transport', () => {
  beforeEach(() => {
    setTransport(null);
    vi.clearAllMocks();
  });

  it.each(CLIENTS.map(([key]) => key))(
    '%s.searchSongs 的每次出网请求都带 cap 过的 timeoutMs 与 signal',
    async (key) => {
      const transport = vi.fn(async () => ({
        status: 200,
        headers: {},
        body: '{}',
        finalUrl: 'https://example.com/probe',
      }));
      setTransport(transport as never);
      const client = CLIENTS.find(([k]) => k === key)![1];

      const controller = new AbortController();
      const opts = { timeoutMs: 1_234, signal: controller.signal };
      // 响应体是空 JSON：解析/map 阶段多半会抛，这不影响断言——请求已经发出去了。
      await client.searchSongs!(`__opts_probe_${key}_${Date.now()}`, 1, opts).catch(() => []);

      expect(transport.mock.calls.length).toBeGreaterThan(0);
      for (const call of transport.mock.calls) {
        expect(call[0].timeoutMs).toBe(1_234);
        expect(call[0].signal).toBe(controller.signal);
      }
    },
  );
});
