import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 封面取色纯函数 + 取图链路（#688）。
 * 这里刻意用合成 BGRA buffer 断言，不依赖真实 electron nativeImage：主进程解码器只负责把图变成
 * 像素，颜色算法本身必须能在纯函数层复现。
 */

const nativeImageMock = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
}));

vi.mock('electron', () => ({
  nativeImage: nativeImageMock,
  session: { defaultSession: { setProxy: vi.fn() } },
}));

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import axios from 'axios';
import { computeAccentFromBitmap, getCoverAccent } from '../../main/services/coverAccent';

const mockedGet = vi.mocked(axios.get);
const mockedCreateFromBuffer = vi.mocked(nativeImageMock.createFromBuffer);

/** 按 BGRA 写一个纯色位图（electron toBitmap 的小端通道序）。 */
function solidBitmap(width: number, height: number, red: number, green: number, blue: number, alpha = 255): Buffer {
  const buffer = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    buffer[index * 4] = blue;
    buffer[index * 4 + 1] = green;
    buffer[index * 4 + 2] = red;
    buffer[index * 4 + 3] = alpha;
  }
  return buffer;
}

/** 依次写入 [r,g,b] 像素，用来构造双色/多色样本。 */
function bitmapFromColors(width: number, height: number, colors: Array<[number, number, number]>): Buffer {
  const buffer = Buffer.alloc(width * height * 4);
  colors.forEach(([red, green, blue], index) => {
    buffer[index * 4] = blue;
    buffer[index * 4 + 1] = green;
    buffer[index * 4 + 2] = red;
    buffer[index * 4 + 3] = 255;
  });
  return buffer;
}

function fakeResizedImage(bitmap: Buffer, width: number, height: number) {
  return {
    isEmpty: () => false,
    resize: () => ({
      getSize: () => ({ width, height }),
      toBitmap: () => bitmap,
    }),
  };
}

describe('computeAccentFromBitmap（BGRA 通道序 + 饱和度加权众数）', () => {
  it('纯红 2×2：hue 0、saturation 1、lightness 0.5', () => {
    expect(computeAccentFromBitmap(solidBitmap(2, 2, 255, 0, 0), 2, 2)).toEqual({
      hue: 0,
      saturation: 1,
      lightness: 0.5,
    });
  });

  it('纯蓝 2×2：hue 240（通道序基准：若把 BGRA 误读成 RGBA 会得到 0）', () => {
    expect(computeAccentFromBitmap(solidBitmap(2, 2, 0, 0, 255), 2, 2)).toEqual({
      hue: 240,
      saturation: 1,
      lightness: 0.5,
    });
  });

  it('4×4 双色：12 个红 + 4 个蓝 → 众数仍是红', () => {
    const colors: Array<[number, number, number]> = Array.from({ length: 16 }, (_, index) =>
      index < 12 ? [255, 0, 0] : [0, 0, 255],
    );
    const accent = computeAccentFromBitmap(bitmapFromColors(4, 4, colors), 4, 4);
    expect(accent?.hue).toBe(0);
    expect(accent?.saturation).toBe(1);
  });

  it('饱和度加权：12 个低饱和绿（s=0.2）输给 4 个高饱和红（s=1）', () => {
    // HSL(120, .2, .5) → rgb(102, 153, 102)
    const colors: Array<[number, number, number]> = Array.from({ length: 16 }, (_, index) =>
      index < 12 ? [102, 153, 102] : [255, 0, 0],
    );
    const accent = computeAccentFromBitmap(bitmapFromColors(4, 4, colors), 4, 4);
    expect(accent?.hue).toBe(0);
    expect(accent?.saturation).toBe(1);
  });

  it('空 buffer / 长度不足 / 尺寸非法 → null', () => {
    expect(computeAccentFromBitmap(Buffer.alloc(0), 2, 2)).toBeNull();
    expect(computeAccentFromBitmap(Buffer.alloc(15), 2, 2)).toBeNull();
    expect(computeAccentFromBitmap(Buffer.alloc(16), 0, 2)).toBeNull();
  });

  it('纯灰（无饱和度）→ null，渲染层回落纯色底', () => {
    expect(computeAccentFromBitmap(solidBitmap(2, 2, 128, 128, 128), 2, 2)).toBeNull();
  });
});

describe('getCoverAccent（IPC 边界的取图/校验）', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedCreateFromBuffer.mockReset();
  });

  it('非字符串 / 空串 / 非 http(s) 或本地路径 → null 且不发请求', async () => {
    await expect(getCoverAccent(null)).resolves.toBeNull();
    await expect(getCoverAccent(undefined)).resolves.toBeNull();
    await expect(getCoverAccent('')).resolves.toBeNull();
    await expect(getCoverAccent('ftp://cover.example.com/a.jpg')).resolves.toBeNull();
    await expect(getCoverAccent('data:image/png;base64,AAAA')).resolves.toBeNull();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('HTTP 封面：按受限参数取图，交给 nativeImage 解码后返回主色', async () => {
    const redBitmap = solidBitmap(2, 2, 255, 0, 0);
    mockedGet.mockResolvedValueOnce({ data: Buffer.from('fake-image-bytes') } as never);
    mockedCreateFromBuffer.mockReturnValueOnce(fakeResizedImage(redBitmap, 2, 2) as never);

    const accent = await getCoverAccent('https://cover.example.com/red.jpg');

    expect(accent).toEqual({ hue: 0, saturation: 1, lightness: 0.5 });
    expect(mockedCreateFromBuffer).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'));
    const options = mockedGet.mock.calls[0][1] as Record<string, unknown>;
    expect(options).toMatchObject({
      responseType: 'arraybuffer',
      timeout: 8000,
      maxContentLength: 5 * 1024 * 1024,
    });
  });

  it('同一 URL 命中内存缓存，不重复取图', async () => {
    const redBitmap = solidBitmap(2, 2, 255, 0, 0);
    mockedGet.mockResolvedValue({ data: Buffer.from('fake-image-bytes') } as never);
    mockedCreateFromBuffer.mockReturnValue(fakeResizedImage(redBitmap, 2, 2) as never);

    await getCoverAccent('https://cover.example.com/cached.jpg');
    await getCoverAccent('https://cover.example.com/cached.jpg');

    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('取图失败静默 null，且失败结果同样进缓存（同一 URL 不反复重试）', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));
    await expect(getCoverAccent('https://cover.example.com/broken.jpg')).resolves.toBeNull();
    await expect(getCoverAccent('https://cover.example.com/broken.jpg')).resolves.toBeNull();
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('nativeImage 解码为空（非图片响应）→ null', async () => {
    mockedGet.mockResolvedValueOnce({ data: Buffer.from('not-an-image') } as never);
    mockedCreateFromBuffer.mockReturnValueOnce({ isEmpty: () => true } as never);
    await expect(getCoverAccent('https://cover.example.com/not-image.jpg')).resolves.toBeNull();
  });
});
