import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../../types/index.js';
import { setTransport } from '../transport.js';
import { sodaDirectClient } from '../sodaDirect.js';
import { musicApi } from '../musicApi.js';

/**
 * 汽水直连客户端测试（T03 #149）。
 * search / resolvePlayableUrl 复用 musicApi 既有直连（分享页直链优先 → track_v2），
 * 薄包装；resolveUrlInfo 为新增的权威完整时长字段（track_v2 的 play_info_list，
 * 供 T12 预检），经 transport 接缝测试。
 */

function textResponse(body: string): any {
  return { status: 200, headers: { 'content-type': 'application/json' }, body, finalUrl: 'https://api.qishui.com/x' };
}

function sodaSong(id = '7260000000000000000', overrides: Partial<Song> = {}): Song {
  return { id, name: '晴天', artist: '周杰伦', album: '', url: '', cover: '', lrc: '', duration: 269, sourceType: 'soda', ...overrides };
}

beforeEach(() => {
  setTransport(null);
  vi.clearAllMocks();
});

describe('sodaDirectClient.resolveUrlInfo（权威完整时长字段，供 T12）', () => {
  it('track_v2 play_info_list 取最大档 size/时长/URL（含 play_auth）', async () => {
    const transport = vi.fn(async () =>
      textResponse(JSON.stringify({
        track: {
          duration: 269000,
          audio_info: {
            play_info_list: [
              { size: 1048576, bitrate: 128, main_play_url: 'http://audio1.soda.cn/a.mp3' },
              { size: 5242880, bitrate: 320, main_play_url: 'http://audio2.soda.cn/b.mp3', play_auth: 'TOKEN' },
            ],
          },
        },
      }))
    );
    setTransport(transport as any);

    const info = await sodaDirectClient.resolveUrlInfo!(sodaSong());

    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0][0];
    expect(req.url).toContain('api.qishui.com/luna/pc/track_v2');
    expect(req.url).toContain('track_id=7260000000000000000');
    expect(info).toEqual({
      url: 'https://audio2.soda.cn/b.mp3?play_auth=TOKEN',
      br: 320,
      size: 5242880,
      playTime: 269000,
      fee: 0,
      payed: 1,
    });
  });

  it('无 play_info_list 返回 null（交由探测/换元）', async () => {
    setTransport(async () => textResponse(JSON.stringify({ track: { duration: 0, audio_info: { play_info_list: [] } } })) as any);
    const info = await sodaDirectClient.resolveUrlInfo!(sodaSong());
    expect(info).toBeNull();
  });

  it('track_v2 空 body（匿名常态）→ 分享页降级拿完整时长', async () => {
    // 匿名 track_v2 返回 200 空 body（2026-08 实测），应降级分享页（免登录）
    // 而非抛 JSON.parse 错误卡死探测链路
    setTransport(async () => textResponse('') as any);
    const spy = vi.spyOn(musicApi, 'fetchSodaSharePage').mockResolvedValue({
      audioUrl: 'https://v5-luna.douyinvod.com/a.mp4',
      name: '屋顶',
      artist: '周杰伦',
      cover: '',
      lyrics: '',
      durationMs: 312999,
    });
    const info = await sodaDirectClient.resolveUrlInfo!(sodaSong());
    expect(spy).toHaveBeenCalledWith('7260000000000000000');
    expect(info).toEqual({
      url: 'https://v5-luna.douyinvod.com/a.mp4',
      br: 0,
      size: 0,
      playTime: 312,
      fee: 0,
      payed: 1,
    });
    spy.mockRestore();
  });

  it('track_v2 与分享页都失败 → 返回 null（探测标不可用，不卡链路）', async () => {
    setTransport(async () => { throw new Error('soda track_v2 失败'); });
    const spy = vi.spyOn(musicApi, 'fetchSodaSharePage').mockResolvedValue(null);
    const info = await sodaDirectClient.resolveUrlInfo!(sodaSong());
    expect(info).toBeNull();
    spy.mockRestore();
  });
});
