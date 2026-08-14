import { describe, expect, it } from 'vitest';
import { lrcSidecarName, looksLikeLyrics } from '../lyrics.js';

describe('lrcSidecarName 拼接 .lrc 侧车路径', () => {
  it('音频文件名换扩展名为 .lrc（与音频同目录同名）', () => {
    expect(lrcSidecarName('晴天 - 周杰伦.mp3')).toBe('晴天 - 周杰伦.lrc');
    expect(lrcSidecarName('晴天 - 周杰伦.flac')).toBe('晴天 - 周杰伦.lrc');
    expect(lrcSidecarName('带路径/a/b/晴天.mp3')).toBe('带路径/a/b/晴天.lrc');
  });
});

describe('looksLikeLyrics 判定歌词内容可用于落盘', () => {
  it('含时间戳的 LRC 内容判定为可用歌词', () => {
    expect(looksLikeLyrics('[00:12.34]你好')).toBe(true);
    expect(looksLikeLyrics('[00:01.20][00:03.40]重复行\n[01:00.00]下一句')).toBe(true);
  });

  it('空内容 / 非法请求页 / 无时间戳的 HTML 判定为不可用', () => {
    expect(looksLikeLyrics('')).toBe(false);
    expect(looksLikeLyrics('')).toBe(false);
    expect(looksLikeLyrics('<html>403 Forbidden</html>')).toBe(false);
    expect(looksLikeLyrics('没有时间戳的纯文本')).toBe(false);
    expect(looksLikeLyrics('{"code":-2,"msg":"非法请求"}')).toBe(false);
  });
});
