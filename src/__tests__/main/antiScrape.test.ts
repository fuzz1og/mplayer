import { describe, it, expect } from 'vitest';
import { getAntiScrapeHeaders, RateLimiter } from '@mplayer/core';

describe('antiScrape', () => {
  describe('getAntiScrapeHeaders', () => {
    it('returns headers with valid structure', () => {
      const headers = getAntiScrapeHeaders();

      expect(headers).toHaveProperty('User-Agent');
      expect(headers).toHaveProperty('Accept');
      expect(headers).toHaveProperty('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6');
      expect(headers).toHaveProperty('Sec-Fetch-Dest', 'document');
      expect(headers).toHaveProperty('Sec-Fetch-Mode', 'navigate');
      expect(headers).toHaveProperty('Upgrade-Insecure-Requests', '1');
    });

    it('sets different User-Agent each call (probabilistic)', () => {
      const agents = new Set(Array.from({ length: 20 }, () => getAntiScrapeHeaders()['User-Agent']));
      // With 10 UAs in pool, 20 random picks should hit at least 2 different ones
      expect(agents.size).toBeGreaterThanOrEqual(2);
    });

    it('sets Sec-Fetch-Site to same-origin when referer provided', () => {
      const headers = getAntiScrapeHeaders('https://music.163.com');
      expect(headers['Sec-Fetch-Site']).toBe('same-origin');
    });

    it('sets Sec-Fetch-Site to none when no referer', () => {
      const headers = getAntiScrapeHeaders();
      expect(headers['Sec-Fetch-Site']).toBe('none');
    });

    it('contains Sec-Ch-Ua header', () => {
      const headers = getAntiScrapeHeaders();
      expect(headers).toHaveProperty('Sec-Ch-Ua');
      // UA 池同时含桌面/移动浏览器，Sec-Ch-Ua-Mobile 跟随随机选中的 UA。
      expect(['?0', '?1']).toContain(headers['Sec-Ch-Ua-Mobile']);
    });
  });

  describe('RateLimiter', () => {
    it('acquires immediately when tokens available', async () => {
      const limiter = new RateLimiter(3, 10);
      await expect(limiter.acquire()).resolves.toBeUndefined();
    });

    it('waits when tokens exhausted and eventually resolves', async () => {
      const limiter = new RateLimiter(1, 100);
      await limiter.acquire();
      await expect(limiter.acquire()).resolves.toBeUndefined();
    });

    it('refills tokens over time', async () => {
      const limiter = new RateLimiter(2, 50);
      // drain tokens
      await limiter.acquire();
      await limiter.acquire();
      // wait for refill
      await expect(limiter.acquire()).resolves.toBeUndefined();
    }, 10000);

    it('handles concurrent acquires', async () => {
      const limiter = new RateLimiter(2, 100);
      const results = await Promise.all([
        limiter.acquire(),
        limiter.acquire(),
        limiter.acquire().then(() => 'third'),
      ]);
      expect(results).toHaveLength(3);
    }, 10000);
  });
});
