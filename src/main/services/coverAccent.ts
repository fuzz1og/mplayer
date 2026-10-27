import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { nativeImage } from 'electron';
import { getHttpAgent, getHttpsAgent } from '../proxy';

/** #688 环境光：封面真实像素 → 24×24 降采样 → 饱和度加权色相众数；URL→主色缓存 300 条。 */

export interface CoverAccent {
  /** 色相，0-359（整数） */
  hue: number;
  /** 饱和度，0-1 */
  saturation: number;
  /** 亮度，0-1 */
  lightness: number;
}

/** 取图超时：封面是装饰性资源，晚到不如没有（8s 与解析链的短请求同量级）。 */
const FETCH_TIMEOUT_MS = 8000;
/** 单张封面上限。正常 CDN 封面远小于此；超过视为异常响应，直接放弃。 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 采样尺寸：24×24 = 576 个像素，足以稳定选主色。 */
const SAMPLE_SIZE = 24;
/** 内存缓存上限（条），超出后按插入顺序淘汰最旧一条（简单 FIFO）。 */
const CACHE_LIMIT = 300;
/** 色相直方图分桶：10° 一格。桶内再按权重求平均，避免 0°/359° 这种边界抖动。 */
const HUE_BIN_COUNT = 36;

const accentCache = new Map<string, CoverAccent | null>();

/** 与浏览器 CSS 的 hsl() 同一套定义：h ∈ [0,360)，s/l ∈ [0,1]。 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 纯函数：BGRA 小端（Skia N32）→ 饱和度×alpha 加权、10° 色相桶众数、桶内单位向量平均。 */
export function computeAccentFromBitmap(
  buffer: Buffer,
  width: number,
  height: number,
): CoverAccent | null {
  if (!buffer || buffer.length === 0) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const pixelCount = Math.floor(width) * Math.floor(height);
  if (buffer.length < pixelCount * 4) return null;

  const binWeights = new Float64Array(HUE_BIN_COUNT);
  const binHueX = new Float64Array(HUE_BIN_COUNT);
  const binHueY = new Float64Array(HUE_BIN_COUNT);
  const binSaturation = new Float64Array(HUE_BIN_COUNT);
  const binLightness = new Float64Array(HUE_BIN_COUNT);

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    // BGRA 小端：见上方通道序说明。
    const blue = buffer[offset];
    const green = buffer[offset + 1];
    const red = buffer[offset + 2];
    const alpha = buffer[offset + 3];
    if (alpha < 16) continue;

    const { h, s, l } = rgbToHsl(red, green, blue);
    if (s <= 0) continue;

    const weight = s * (alpha / 255);
    const bin = Math.min(HUE_BIN_COUNT - 1, Math.floor((h / 360) * HUE_BIN_COUNT));
    const radians = (h * Math.PI) / 180;
    binWeights[bin] += weight;
    binHueX[bin] += Math.cos(radians) * weight;
    binHueY[bin] += Math.sin(radians) * weight;
    binSaturation[bin] += s * weight;
    binLightness[bin] += l * weight;
  }

  let dominantBin = -1;
  let dominantWeight = 0;
  for (let bin = 0; bin < HUE_BIN_COUNT; bin += 1) {
    if (binWeights[bin] > dominantWeight) {
      dominantWeight = binWeights[bin];
      dominantBin = bin;
    }
  }
  // 纯灰/纯透明封面没有可用色相：返回 null，渲染层回落纯色底。
  if (dominantBin < 0 || dominantWeight <= 0) return null;

  let hue = (Math.atan2(binHueY[dominantBin], binHueX[dominantBin]) * 180) / Math.PI;
  if (hue < 0) hue += 360;

  return {
    hue: Math.round(hue) % 360,
    saturation: round2(binSaturation[dominantBin] / dominantWeight),
    lightness: round2(binLightness[dominantBin] / dominantWeight),
  };
}

/** 封面来源是否在允许范围内：http(s) URL 或本地绝对路径（含 file://）。 */
export function isSupportedCoverSource(coverUrl: string): boolean {
  const value = coverUrl.trim();
  if (!value) return false;

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  if (/^file:/i.test(value)) {
    try {
      return path.isAbsolute(fileURLToPath(value));
    } catch {
      return false;
    }
  }

  // Windows 盘符路径（C:\... / C:/...）在 POSIX 测试环境下 path.isAbsolute 不认，单独放行。
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (path.isAbsolute(value)) return true;

  // data:/ftp:/blob: 等其它协议一律拒绝：IPC 只做「封面取色」，不做通用取图代理。
  return false;
}

function localPathFromCoverSource(coverUrl: string): string | null {
  if (/^file:/i.test(coverUrl)) {
    try {
      const filePath = fileURLToPath(coverUrl);
      return path.isAbsolute(filePath) ? filePath : null;
    } catch {
      return null;
    }
  }
  return path.isAbsolute(coverUrl) ? coverUrl : null;
}

async function fetchRemoteImage(url: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
    headers: {
      Accept: 'image/*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    },
    // 与主进程其它请求同一条代理路径：用户配了代理时封面也走代理。
    httpAgent: getHttpAgent(),
    httpsAgent: getHttpsAgent(),
  });
  const data = response.data;
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(data);
}

async function readLocalImage(filePath: string): Promise<Buffer> {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) return Buffer.alloc(0);
  return fsp.readFile(filePath);
}

function accentFromImageBuffer(imageBuffer: Buffer): CoverAccent | null {
  if (imageBuffer.length === 0 || imageBuffer.length > MAX_IMAGE_BYTES) return null;
  const image = nativeImage.createFromBuffer(imageBuffer);
  if (image.isEmpty()) return null;

  const resized = image.resize({ width: SAMPLE_SIZE, height: SAMPLE_SIZE, quality: 'good' });
  const { width, height } = resized.getSize();
  if (width <= 0 || height <= 0) return null;
  return computeAccentFromBitmap(resized.toBitmap(), width, height);
}

function rememberAccent(key: string, accent: CoverAccent | null): void {
  if (accentCache.size >= CACHE_LIMIT && !accentCache.has(key)) {
    const oldest = accentCache.keys().next().value;
    if (oldest !== undefined) accentCache.delete(oldest);
  }
  accentCache.set(key, accent);
}

/**
 * 封面 → 主色。任何失败（网络、解码、非法路径）都静默返回 null：
 * 环境光是装饰，不能影响播放页本身。
 */
export async function getCoverAccent(coverUrl: unknown): Promise<CoverAccent | null> {
  if (typeof coverUrl !== 'string') return null;
  const key = coverUrl.trim();
  if (!key || !isSupportedCoverSource(key)) return null;

  if (accentCache.has(key)) return accentCache.get(key) ?? null;

  try {
    let imageBuffer: Buffer;
    if (/^https?:\/\//i.test(key)) {
      imageBuffer = await fetchRemoteImage(key);
    } else {
      const localPath = localPathFromCoverSource(key);
      if (!localPath) {
        rememberAccent(key, null);
        return null;
      }
      imageBuffer = await readLocalImage(localPath);
    }
    const accent = accentFromImageBuffer(imageBuffer);
    // 成功与失败都缓存：同一个封面 URL 不在一次会话里反复重试（上限 300 条，FIFO 会淘汰旧条目）。
    rememberAccent(key, accent);
    return accent;
  } catch {
    rememberAccent(key, null);
    return null;
  }
}
