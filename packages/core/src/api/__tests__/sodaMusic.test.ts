import { describe, it, expect, vi, beforeEach } from 'vitest';
import { musicApi, sodaSentencesToLrc } from '../musicApi.js';

/**
 * 汽水音乐搜索/歌词（#181 收尾续作）：
 * - 搜索路径：luna/search/track（无 pc 段，免登录；旧 luna/pc/search/track 已失效空 body）
 * - 分享页歌词：_ROUTER_DATA.lyrics.sentences[] 结构化 → LRC（sodaSentencesToLrc 纯函数）
 * - getSodaLyrics：分享页免登录取歌词 + 缓存
 */

describe('sodaSentencesToLrc（分享页结构化歌词 → LRC 纯函数）', () => {
  it('words[].text 拼接成行文本 + [mm:ss.xxx] 时间轴', () => {
    const sentences = [
      { startMs: 0, endMs: 16285, text: '作曲：周杰伦', words: [{ text: '作曲：周杰伦', startMs: 0, endMs: 16285 }], type: 'lrc' },
      { startMs: 11485, endMs: 22800, text: '半夜睡不着觉', words: [{ text: '半', startMs: 0 }, { text: '夜', startMs: 500 }, { text: '睡不着觉', startMs: 1000 }], type: 'krc' },
      { startMs: 61000, endMs: 70000, text: '', words: [], type: 'lrc' },
    ];
    const lrc = sodaSentencesToLrc(sentences);
    expect(lrc).toBe('[00:00.000]作曲：周杰伦\n[00:11.485]半夜睡不着觉');
  });

  it('words 缺失回退整句 text', () => {
    const sentences = [{ startMs: 65000, text: '无 words 行' }];
    expect(sodaSentencesToLrc(sentences)).toBe('[01:05.000]无 words 行');
  });

  it('空/非数组返回空串', () => {
    expect(sodaSentencesToLrc([])).toBe('');
    expect(sodaSentencesToLrc(null)).toBe('');
    expect(sodaSentencesToLrc(undefined)).toBe('');
  });

  it('跳过无 startMs 或空文本行', () => {
    const sentences = [
      { text: '无时间' },
      { startMs: 1000, text: '   ' },
      { startMs: 2000, text: '有效行' },
    ];
    expect(sodaSentencesToLrc(sentences)).toBe('[00:02.000]有效行');
  });
});

describe('musicApi 汽水搜索/歌词接线', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('searchSongsSoda 走 luna/search/track（无 pc 段）', async () => {
    const spy = vi.spyOn(musicApi, 'searchSongsSoda');
    // 直接验证 URL 构造：mock transport 拦截 request
    const { setTransport } = await import('../transport.js');
    const transport = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        result_groups: [{
          data: [{
            entity: {
              track: {
                id: '7145679509738489867',
                name: '屋顶',
                artists: [{ name: '周杰伦' }],
                album: { name: '屋顶', url_cover: { urls: ['https://p3-luna.douyinpic.com/img/'], uri: 'tos-cn-v-2774c002/abc' } },
                duration: 312999,
              },
            },
          }],
        }],
      }),
      finalUrl: 'https://api.qishui.com/luna/search/track',
    }));
    setTransport(transport as any);
    try {
      const songs = await musicApi.searchSongsSoda('周杰伦', 1);
      const req = transport.mock.calls[0][0];
      expect(req.url).toContain('api.qishui.com/luna/search/track');
      expect(req.url).not.toContain('/pc/');
      expect(songs).toHaveLength(1);
      expect(songs[0]).toMatchObject({
        id: '7145679509738489867',
        name: '屋顶',
        artist: '周杰伦',
        album: '屋顶',
        sourceType: 'soda',
        duration: 312,
        lrc: '',
      });
      expect(songs[0].cover).toContain('~c5_375x375.jpg');
    } finally {
      setTransport(null);
      spy.mockRestore();
    }
  });

  it('getSodaLyrics：走 fetchSodaSharePage 返回 LRC，缓存命中二次不重复请求', async () => {
    const pageSpy = vi.spyOn(musicApi, 'fetchSodaSharePage').mockResolvedValue({
      audioUrl: 'https://v5-luna.douyinvod.com/a.mp4',
      name: '屋顶',
      artist: '周杰伦',
      cover: '',
      lyrics: '[00:00.000]作曲：周杰伦\n[00:11.485]半夜睡不着觉',
      durationMs: 312999,
    });
    const lrc1 = await musicApi.getSodaLyrics('7145679509738489867');
    expect(lrc1).toContain('[00:00.000]作曲：周杰伦');
    const lrc2 = await musicApi.getSodaLyrics('7145679509738489867');
    expect(lrc2).toBe(lrc1);
    expect(pageSpy).toHaveBeenCalledTimes(1); // 缓存命中，未二次请求
    pageSpy.mockRestore();
  });

  it('getSodaLyrics：分享页无歌词返回空串', async () => {
    vi.spyOn(musicApi, 'fetchSodaSharePage').mockResolvedValue({
      audioUrl: 'https://v5-luna.douyinvod.com/a.mp4',
      name: '无词歌',
      artist: 'x',
      cover: '',
      lyrics: '',
      durationMs: 0,
    });
    await expect(musicApi.getSodaLyrics('1')).resolves.toBe('');
    vi.restoreAllMocks();
  });
});
