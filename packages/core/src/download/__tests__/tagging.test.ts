import { describe, expect, it } from 'vitest';
import { tagStrategyForContainer, buildID3Frames, ID3_FRAME_TLEN } from '../tagging.js';

describe('tagStrategyForContainer 按容器选择标签写入方式', () => {
  it('MP3 → id3（mp3tag.js ID3）', () => {
    expect(tagStrategyForContainer('mp3')).toBe('id3');
  });

  it('M4A → mp4（mp4tag/ID32 容器标签）', () => {
    expect(tagStrategyForContainer('m4a')).toBe('mp4');
  });

  it('FLAC / Ogg / unknown → skip（宁可不写也不错灌 ID3）', () => {
    expect(tagStrategyForContainer('flac')).toBe('skip');
    expect(tagStrategyForContainer('ogg')).toBe('skip');
    expect(tagStrategyForContainer('unknown')).toBe('skip');
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
