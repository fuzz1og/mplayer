import { describe, expect, it, vi } from 'vitest';
import {
  UPDATE_SOURCE_DEFS,
  GITHUB_LATEST_BASE,
  toGenericFeedUrl,
  buildAssetUrl,
  rankSourcesByLatency,
  probeUpdateSources,
} from '../updateChannels.js';

function fakeOk() {
  return { arrayBuffer: async () => new ArrayBuffer(64) };
}

describe('updateChannels', () => {
  it('静态清单镜像在前、GitHub 直连垫底', () => {
    expect(UPDATE_SOURCE_DEFS.map((d) => d.id)).toEqual(['gh-proxy', 'ghfast', 'ghproxynet', 'github']);
    expect(UPDATE_SOURCE_DEFS[3].prefix).toBe('');
  });

  it('toGenericFeedUrl：直连源返回空串，镜像返回前缀拼接地址', () => {
    const [mirror, direct] = UPDATE_SOURCE_DEFS;
    expect(toGenericFeedUrl(direct)).toBe('');
    expect(toGenericFeedUrl(mirror)).toBe(`https://gh-proxy.com/${GITHUB_LATEST_BASE}`);
  });

  it('buildAssetUrl 拼接固定资产地址', () => {
    const mirror = UPDATE_SOURCE_DEFS[0];
    expect(buildAssetUrl(mirror, 'latest.yml')).toBe(
      `https://gh-proxy.com/${GITHUB_LATEST_BASE}latest.yml`,
    );
    expect(buildAssetUrl(UPDATE_SOURCE_DEFS[3], 'a.apk')).toBe(`${GITHUB_LATEST_BASE}a.apk`);
  });

  it('rankSourcesByLatency 按延迟升序、失败(null)垫底、并列保持相对顺序', () => {
    const latencies = new Map<string, number | null>([
      ['ghfast', 20],
      ['ghproxynet', 5],
      ['gh-proxy', null], // 失败 → 垫底（在 github 之后仍保持原相对顺序）
      ['github', 5], // 与 ghproxynet 并列 → 保持原顺序在其后
    ]);
    expect(rankSourcesByLatency(UPDATE_SOURCE_DEFS, latencies).map((d) => d.id)).toEqual([
      'ghproxynet',
      'github',
      'ghfast',
      'gh-proxy',
    ]);
  });

  it('rankSourcesByLatency 全失败时保持静态兜底顺序', () => {
    const allNull = new Map<string, number | null>(UPDATE_SOURCE_DEFS.map((d) => [d.id, null]));
    expect(rankSourcesByLatency(UPDATE_SOURCE_DEFS, allNull).map((d) => d.id)).toEqual([
      'gh-proxy',
      'ghfast',
      'ghproxynet',
      'github',
    ]);
  });

  it('probeUpdateSources 并发探测全部源，成功计延迟、失败为 null', async () => {
    const seenUrls: string[] = [];
    const fetchLike = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      seenUrls.push(url);
      expect(init?.headers?.Range).toBe('bytes=0-4095');
      if (url.includes('github.com')) throw new Error('unreachable'); // 直连失败
      await new Promise((r) => setTimeout(r, url.includes('ghfast') ? 1 : 15));
      return fakeOk();
    });

    const results = await probeUpdateSources(fetchLike);

    expect(fetchLike).toHaveBeenCalledTimes(4);
    expect(results.get('github')).toBeNull();
    expect(results.get('ghfast')).not.toBeNull();
    expect(results.get('gh-proxy')).not.toBeNull();
    // 每个 URL 都是 latest.yml 探针
    expect(seenUrls.every((u) => u.endsWith('latest.yml'))).toBe(true);
    expect(seenUrls.filter((u) => u.includes('gh-proxy.com/https://github.com'))).toHaveLength(1);
  });

  it('probeUpdateSources 超时的源以 null 表达，整体不 reject', async () => {
    const fetchLike = vi.fn(async () => {
      await new Promise(() => {}); // 永不 resolve，靠 abort 触发
      return fakeOk();
    });

    const results = await probeUpdateSources(fetchLike, { timeoutMs: 40 });

    for (const def of UPDATE_SOURCE_DEFS) {
      expect(results.get(def.id)).toBeNull();
    }
  });
});
