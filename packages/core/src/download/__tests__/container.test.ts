import { describe, expect, it } from 'vitest';
import {
  detectAudioContainer,
  containerFromContentType,
  extensionForContainer,
  replaceExtension,
} from '../container.js';

const B = (...hex: number[]) => new Uint8Array(hex);

describe('detectAudioContainer 容器识别', () => {
  it('ID3 头与 MPEG 帧同步头 → mp3', () => {
    expect(detectAudioContainer(B(0x49, 0x44, 0x33, 0x03, 0x00))).toBe('mp3');
    expect(detectAudioContainer(B(0xff, 0xfb, 0x90, 0x00))).toBe('mp3');
  });

  it('fLaC 头 → flac', () => {
    expect(detectAudioContainer(B(0x66, 0x4c, 0x61, 0x43))).toBe('flac');
  });

  it('OggS 头 → ogg', () => {
    expect(detectAudioContainer(B(0x4f, 0x67, 0x67, 0x53, 0x00))).toBe('ogg');
  });

  it('MP4 ftyp 头 → m4a', () => {
    expect(detectAudioContainer(B(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe('m4a');
  });

  it('未知/空/太短 → unknown', () => {
    expect(detectAudioContainer(new Uint8Array(0))).toBe('unknown');
    expect(detectAudioContainer(B(0x11, 0x22))).toBe('unknown');
    expect(detectAudioContainer(B(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))).toBe('unknown');
  });
});

describe('containerFromContentType 由响应头推断容器', () => {
  it('audio/mpeg → mp3', () => {
    expect(containerFromContentType('audio/mpeg')).toBe('mp3');
    expect(containerFromContentType('audio/mp3')).toBe('mp3');
  });

  it('audio/mp4 / video/mp4 / audio/x-m4a → m4a', () => {
    expect(containerFromContentType('audio/mp4')).toBe('m4a');
    expect(containerFromContentType('video/mp4')).toBe('m4a');
    expect(containerFromContentType('audio/x-m4a')).toBe('m4a');
  });

  it('audio/flac → flac', () => {
    expect(containerFromContentType('audio/flac')).toBe('flac');
  });

  it('audio/ogg / application/ogg → ogg', () => {
    expect(containerFromContentType('audio/ogg')).toBe('ogg');
    expect(containerFromContentType('application/ogg')).toBe('ogg');
  });

  it('未知 Content-Type / 空 → null', () => {
    expect(containerFromContentType('text/html')).toBeNull();
    expect(containerFromContentType('')).toBeNull();
    expect(containerFromContentType('application/json')).toBeNull();
  });
});

describe('extensionForContainer 映射', () => {
  it('返回对应文件后缀', () => {
    expect(extensionForContainer('mp3')).toBe('.mp3');
    expect(extensionForContainer('m4a')).toBe('.m4a');
    expect(extensionForContainer('flac')).toBe('.flac');
    expect(extensionForContainer('ogg')).toBe('.ogg');
  });

  it('unknown → 默认 .mp3', () => {
    expect(extensionForContainer('unknown')).toBe('.mp3');
  });
});

describe('replaceExtension 同名换后缀（.lrc 侧车路径拼接）', () => {
  it('把音频文件名后缀换成 .lrc', () => {
    expect(replaceExtension('晴天 - 周杰伦.mp3', '.lrc')).toBe('晴天 - 周杰伦.lrc');
    expect(replaceExtension('晴天 - 周杰伦.flac', '.lrc')).toBe('晴天 - 周杰伦.lrc');
  });

  it('无后缀/多后缀文件也能正确换', () => {
    expect(replaceExtension('song.tar.mp4', '.lrc')).toBe('song.tar.lrc');
    expect(replaceExtension('nosuffix', '.lrc')).toBe('nosuffix.lrc');
  });
});
