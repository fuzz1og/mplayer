import { describe, it, expect } from 'vitest'
import { isImageBytes, isAudioBytes } from '../sniffers'

const textEncoder = new TextEncoder()
const B = (...hex: number[]) => new Uint8Array(hex)

describe('sniffers 格式头嗅探单点', () => {
  describe('isImageBytes 图片白名单', () => {
    it('JPEG (FF D8 FF)', () => expect(isImageBytes(B(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe(true))

    it('PNG (89 50 4E 47)', () =>
      expect(isImageBytes(B(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true))

    it('WebP (RIFF....WEBP)', () =>
      expect(isImageBytes(B(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe(true))

    it('GIF (GIF8)', () => expect(isImageBytes(B(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe(true))

    it('AVIF (ftypavif)', () =>
      expect(isImageBytes(B(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66))).toBe(true))

    it('ICO/CUR (00 00 01 00)', () => expect(isImageBytes(B(0x00, 0x00, 0x01, 0x00))).toBe(true))

    it('BMP (42 4D)', () => expect(isImageBytes(B(0x42, 0x4d, 0x00, 0x00))).toBe(true))

    it('非图片（HTML 错误页/空）返回 false', () => {
      expect(isImageBytes(textEncoder.encode('<html>error</html>'))).toBe(false)
      expect(isImageBytes(new Uint8Array(0))).toBe(false)
    })
  })

  describe('isAudioBytes 音频白名单', () => {
    it('ID3 (MP3)', () => expect(isAudioBytes(B(0x49, 0x44, 0x33, 0x03, 0x00))).toBe(true))
    it('FLAC (fLaC)', () => expect(isAudioBytes(B(0x66, 0x4c, 0x61, 0x43))).toBe(true))
    it('Ogg (OggS)', () => expect(isAudioBytes(B(0x4f, 0x67, 0x67, 0x53, 0x00))).toBe(true))
    it('MP4 容器 (ftyp)', () =>
      expect(isAudioBytes(B(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe(true))
    it('MPEG 帧同步头 (FF Ex)', () => expect(isAudioBytes(B(0xff, 0xfb, 0x90, 0x00))).toBe(true))
    it('非音频返回 false', () => expect(isAudioBytes(textEncoder.encode('hello'))).toBe(false))
  })

  it('Buffer 与 Uint8Array 均可工作（Buffer 是 Uint8Array 子类）', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(isImageBytes(png)).toBe(true)
    expect(isImageBytes(B(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true)
  })
})
