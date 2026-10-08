import { describe, expect, it } from 'vitest';
import { tagStrategyForContainer, planAudioTagging, buildID3Frames, ID3_FRAME_TLEN } from '../tagging.js';
import type { AudioContainer } from '../container.js';

describe('tagStrategyForContainer 按容器选择标签写入方式', () => {
  it('MP3 → id3（mp3tag.js ID3）', () => {
    expect(tagStrategyForContainer('mp3')).toBe('id3');
  });

  it('M4A → skip（#607 实测：mp3tag.js 只写 ID32，非 iTunes ilst/covr，标准读取方读不回）', () => {
    expect(tagStrategyForContainer('m4a')).toBe('skip');
  });

  it('FLAC / Ogg / unknown → skip（宁可不写也不错灌 ID3）', () => {
    expect(tagStrategyForContainer('flac')).toBe('skip');
    expect(tagStrategyForContainer('ogg')).toBe('skip');
    expect(tagStrategyForContainer('unknown')).toBe('skip');
  });

  it('策略全集只有 id3 / skip——不再存在没有任何容器映射的 mp4', () => {
    const all: AudioContainer[] = ['mp3', 'm4a', 'flac', 'ogg', 'unknown'];
    expect(new Set(all.map(tagStrategyForContainer))).toEqual(new Set(['id3', 'skip']));
  });
});

describe('planAudioTagging 是两端消费的唯一决策（#607）', () => {
  it('MP3：id3 + 无跳过原因', () => {
    expect(planAudioTagging('mp3')).toEqual({ container: 'mp3', strategy: 'id3', skipReason: null });
  });

  it('M4A / FLAC / Ogg / unknown：skip + 可读原因（双端日志同一句）', () => {
    for (const c of ['m4a', 'flac', 'ogg', 'unknown'] as AudioContainer[]) {
      const plan = planAudioTagging(c);
      expect(plan.strategy).toBe('skip');
      expect(plan.skipReason).toBeTruthy();
      expect(plan.skipReason).toContain('跳过标签写入');
    }
  });

  it('M4A 的原因点明 ID32 实测依据（避免下次再把「有写入路径」误判成「支持」）', () => {
    expect(planAudioTagging('m4a').skipReason).toContain('ID32');
  });

  it('计划与策略函数同源：plan.strategy === tagStrategyForContainer(container)', () => {
    for (const c of ['mp3', 'm4a', 'flac', 'ogg', 'unknown'] as AudioContainer[]) {
      expect(planAudioTagging(c).strategy).toBe(tagStrategyForContainer(c));
    }
  });
});

describe('buildID3Frames 构造真实标签帧', () => {
  it('基础曲目信息始终写入（标题/歌手/专辑）', () => {
    const frames = buildID3Frames({ title: '晴天', artist: '周杰伦', album: '叶惠美' });
    expect(frames.v2.TIT2).toBe('晴天');
    expect(frames.v2.TPE1).toBe('周杰伦');
    expect(frames.v2.TALB).toBe('叶惠美');
    // 有真实时长时 notes 为空（见对应用例）；未传时长会被记录一次跳过原因
    expect(frames.notes.some((n) => n.includes('TLEN'))).toBe(true);
  });

  it('有真实时长时写入 TLEN（毫秒）', () => {
    const frames = buildID3Frames({ title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 240_000 });
    expect(frames.v2[ID3_FRAME_TLEN]).toBe('240000');
  });

  it('时长缺失/为 0 时不写 TLEN（不写伪造值）', () => {
    const noDuration = buildID3Frames({ title: 'a', artist: 'b', album: 'c' });
    expect(noDuration.v2[ID3_FRAME_TLEN]).toBeUndefined();
    const zeroDuration = buildID3Frames({ title: 'a', artist: 'b', album: 'c', durationMs: 0 });
    expect(zeroDuration.v2[ID3_FRAME_TLEN]).toBeUndefined();
  });

  it('带封面时写 APIC，缺封面不写', () => {
    const withCover = buildID3Frames({
      title: 'a',
      artist: 'b',
      album: 'c',
      cover: { format: 'image/jpeg', bytes: [1, 2, 3] },
    });
    expect(withCover.v2.APIC).toEqual([{ format: 'image/jpeg', type: 3, description: 'Cover', data: [1, 2, 3] }]);

    const without = buildID3Frames({ title: 'a', artist: 'b', album: 'c' });
    expect(without.v2.APIC).toBeUndefined();
  });
});
