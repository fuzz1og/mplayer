import axios from 'axios';

/**
 * 传输接缝（T01）—— core 请求层底部的统一可注入传输。
 *
 * 目的：让「直接客户端」（T02+ 各源官方直连）与「预检」（T12）等新请求层代码
 * 统一经 `request()` 出网；测试注入 mock 传输即可在 core 接缝上驱动全部请求层
 * 行为（成功率/回退/重试/超时），不真实出网。默认实现 = axios（双端可用），
 * 未注入时行为与现状一致。
 *
 * 使用约定：
 * - 请求体由调用方序列化（form / JSON），本层不关心内容；
 * - `responseType: 'arraybuffer'` 供需要字节内容的调用（探测/302 解析）使用；
 * - `finalUrl` 为最终地址（重定向链终点），无则回退请求 URL。
 */

export interface TransportRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** 已序列化的请求体（form / JSON 字符串）。 */
  body?: string;
  timeoutMs?: number;
  responseType?: 'text' | 'arraybuffer';
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string | ArrayBuffer;
  /** 重定向链终点地址；无重定向时为请求 URL。 */
  finalUrl: string;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

let active: Transport | null = null;

/** 注入测试/桥接传输；传 null 恢复默认 axios 实现。 */
export function setTransport(transport: Transport | null): void {
  active = transport;
}

export function getTransport(): Transport | null {
  return active;
}

/** 统一请求入口：有注入传输走注入，否则走默认 axios 实现。 */
export async function request(req: TransportRequest): Promise<TransportResponse> {
  if (active) return active(req);
  return defaultTransport(req);
}

async function defaultTransport(req: TransportRequest): Promise<TransportResponse> {
  const resp = await axios.request({
    method: req.method,
    url: req.url,
    headers: req.headers,
    data: req.body,
    timeout: req.timeoutMs || 12000,
    responseType: req.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    validateStatus: () => true,
  });
  const finalUrl = (resp.request as { responseURL?: string } | undefined)?.responseURL;
  return {
    status: resp.status,
    headers: resp.headers as Record<string, string>,
    body: resp.data as string | ArrayBuffer,
    finalUrl: finalUrl && /^https?:\/\//.test(finalUrl) ? finalUrl : req.url,
  };
}
