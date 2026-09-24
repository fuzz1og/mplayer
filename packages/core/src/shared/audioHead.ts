import { request, bodyToBytes, type Transport } from '../api/transport.js';
import { isAudioBytes } from '../utils/sniffers.js';

/**
 * 音频头部 Range 取证接缝（#361 提出、#392 复用）。
 *
 * 一次 `Range: bytes=0-N` GET 同时给出：字节（喂 `isAudioBytes` 拒 text/html 错误页，
 * 以及 `extractAudioDuration` 的 L2 头解析）与**完整大小**（206 的 content-range 总量 /
 * 200 的 content-length，L3「体积 × 8 ÷ 码率」用）。
 *
 * 取 64KB 而非 1KB：ADR-0014 实测 1KB~1MB 延迟无差别（成本在连接建立 + TLS + 一个 RTT，
 * 不在字节数），而 64KB 能让 MP4 moov / MP3 Xing 等全局头更容易落在缓冲内。
 *
 * ⚠️ 已知未解决：若服务器忽略 Range（实测有主机对 bytes=0-1023 返回全量），
 * 调用方会缓冲整个响应体直至超时 → 好 URL 被误判。需 transport 支持响应字节上限/
 * 提前中断；未支持前如实记录，见 ADR-0014「后果」。
 */

/** 头部 Range 字节数（tier3 护栏取证与直连腿取证共用同一口径）。 */
export const AUDIO_HEAD_RANGE_BYTES = 64 * 1024;

export interface AudioHeadResult {
  /** ok = 拿到的是音频字节（非 HTML 错误页、非空）。 */
  ok: boolean;
  /** 完整大小（content-range / content-length 总量）；未知为 null。 */
  totalBytes: number | null;
  bytes: Uint8Array;
}

const EMPTY_BYTES = new Uint8Array(0);

const FAIL: AudioHeadResult = { ok: false, totalBytes: null, bytes: EMPTY_BYTES };

/** 取音频头部字节 + 完整大小；任何失败（网络 / 非音频 / 4xx）返回 ok=false，不上抛。 */
export async function fetchAudioHead(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs: number; request?: Transport },
): Promise<AudioHeadResult> {
  try {
    const req = opts.request || request;
    const res = await req({
      method: 'GET',
      url,
      headers: { Range: `bytes=0-${AUDIO_HEAD_RANGE_BYTES - 1}`, ...(opts.headers || {}) },
      timeoutMs: opts.timeoutMs,
      responseType: 'arraybuffer',
    });
    if (res.status >= 400) return FAIL;
    const ct = String(res.headers['content-type'] || '');
    if (ct.includes('text/html')) return FAIL;
    // Node 下 axios arraybuffer 返回 Buffer（不是 ArrayBuffer）：必须走 bodyToBytes，
    // 否则会落到文本分支把二进制毁掉（实测 FLAC 头 → 时长解析成 25069s）。
    const bytes = bodyToBytes(res.body);
    if (!isAudioBytes(bytes)) return FAIL;
    // 206：Range 被支持，content-range 的 /total 是完整大小；200：Content-Length。
    let totalBytes: number | null = null;
    if (res.status === 206) {
      const cr = String(res.headers['content-range'] || '');
      const total = cr ? parseInt(cr.split('/')[1] || '', 10) : null;
      if (total && Number.isFinite(total)) totalBytes = total;
    } else {
      const cl = String(res.headers['content-length'] || '');
      if (cl) {
        const n = parseInt(cl, 10);
        if (Number.isFinite(n)) totalBytes = n;
      }
    }
    return { ok: true, totalBytes, bytes };
  } catch {
    return FAIL;
  }
}
