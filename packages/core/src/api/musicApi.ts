import axios, { type AxiosInstance } from 'axios';
import type { Song, SourceKey, SongGroup, AudioTag } from '../types/index.js';
import { cacheManager } from './memoryCacheManager.js';
import { beforeRequest, getAntiScrapeHeaders } from './antiScrape.js';
import { BROWSER_UA, refererForUrl } from '../utils/sourceReferer.js';
import { decodeBase64Utf8 } from '../utils/base64.js';
import { looksLikeLyrics } from '../download/lyrics.js';
import { request, bodyToText } from './transport.js';
import { groupIntoSongGroups as groupIntoSongGroupsUtil } from '../utils/groupIntoSongGroups.js';
import { probeSongs } from './probeSongs.js';
import { rememberProbeResult } from './prefetchCache.js';
import {
  searchSongsRouted as routedSearchSongs,
  resolvePlayableUrlRouted as routedResolveUrl,
  resolvePlayableSongRouted as routedResolveSong,
  resolvePlayableSongDirect as routedResolveSongDirect,
} from '../shared/sourceRouter.js';
import { decodeKuwoLyricBody } from './kuwoDirect.js';
import { resolveKugouLyricUrl } from './kugouDirect.js';
import { fetchLyricViaGateway } from './qqDirect.js';
import type { Agent } from 'http';

let API_BASE_URL = '';
let PROXY_URL = '';
/** WebView 桥请求处理器（mobile 注入）：绕开 RN OkHttp 网络栈 */
let apiRequestHandler:
  | ((req: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: string;
      /** 只取最终地址和响应头，不读 body（mp3 直链可能几十 MB） */
      rangeOnly?: boolean;
      /** 桥内 abort 超时（毫秒）；未传时由调用方兜底 */
      timeoutMs?: number;
    }) => Promise<{
      status: number;
      headers: Record<string, string>;
      text: string;
      finalUrl: string;
    }>)
  | null = null;

export function setApiRequestHandler(
  handler: typeof apiRequestHandler,
): void {
  apiRequestHandler = handler;
}

/** axios 自定义 adapter：有桥走桥（Chromium 栈），否则退回默认（Node/桌面） */
async function bridgeOrDefaultAdapter(config: any): Promise<any> {
  const release = await acquireApiGate(config);
  try {
    const requestPromise = dispatchWithAdapter(config);
    // 自定义 adapter 必须自己执行 config.timeout（axios 只对内置 adapter
    // 计时）。桥内会按 timeoutMs abort，这里再加一层 JS 侧竞速兜底，
    // 保证 WebView 异常（不回调）时请求也能按时失败而不是挂死。
    const timeoutMs = Number(config.timeout) || 0;
    if (!timeoutMs || timeoutMs <= 0) return await requestPromise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new axios.AxiosError(
          `timeout of ${timeoutMs}ms exceeded`,
          axios.AxiosError.ETIMEDOUT,
          config,
        ));
      }, timeoutMs);
    });
    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    release();
  }
}

function getDefaultAdapter(): any {
  return (axios as any).getAdapter
    ? (axios as any).getAdapter((axios as any).defaults.adapter)
    : (axios as any).defaults.adapter;
}

async function dispatchWithAdapter(config: any): Promise<any> {
  if (!apiRequestHandler) {
    // 无桥（桌面/测试）：解析 axios 默认 adapter（defaults.adapter 是
    // ['xhr','http','fetch'] 字符串数组，需 getAdapter 转成平台函数）
    return getDefaultAdapter()(config);
  }
  const method = (config.method || 'get').toUpperCase();
  const headers: Record<string, string> = {};
  const rawHeaders = config.headers?.toJSON ? config.headers.toJSON() : config.headers || {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (v != null && k.toLowerCase() !== 'cookie') headers[k] = String(v);
  }
  const body =
    config.data != null
      ? typeof config.data === 'string'
        ? config.data
        : JSON.stringify(config.data)
      : undefined;
  let res;
  try {
    res = await apiRequestHandler({
      method,
      url: config.url || '',
      headers,
      body,
      timeoutMs: Number(config.timeout) || 0,
    });
  } catch (err: any) {
    // 桥基础设施故障（启动失败 / 页面未加载 / 跨源被拒）时回退平台默认
    // 栈，请求仍能发出；普通超时/HTTP 错误原样抛出（回退只会再白等一轮）
    const msg = String(err?.message || err || '');
    if (/bridge startup failed|bridge ready timeout|Failed to fetch|NetworkError/i.test(msg)) {
      return getDefaultAdapter()(config);
    }
    throw err;
  }
  return {
    data: res.text,
    status: res.status,
    statusText: String(res.status),
    headers: res.headers,
    config,
    request: { responseURL: res.finalUrl },
  };
}

// ── 全局 API 并发闸门（双池）────────────────────────────────────
// 上游服务端对同 IP 并发连接数有硬限制（实测并发超过 ~3-4 个即挂起
// 直到超时）。拆成两个独立池，避免互相拖死：
// - 关键池 cap 2：搜索 POST / 播放直链(get=url) / 会话引导——播放与
//   刷新必须保活，优先级 0=播放直链(插队) / 1=搜索·会话
// - 封面池 cap 1：get=pic / get=lrc——整列表封面解析量大，但不能占用
//   关键槽位，否则搜索洪峰期间封面永远排队（实测排队 87s 后 3s 超时
//   全部失败，界面只剩默认占位图）；独立 1 槽保证封面稳定渐进。
// 双池合计峰值 ≤3，仍在服务端承受范围内。
interface GatePool {
  cap: number;
  active: number;
  queue: { priority: number; resolve: () => void; since: number }[];
}

// 并发上限是实测确定的，不要随意调高：
// 上游 API 服务端对并发有硬性限速——10 个并行搜索实测每个 5-15s（都能返回
// 但被拖慢），2-3 个顺序/低并发则 ~550ms/个。cap=2 保证不触发并发限速；
// 提高 cap 会让整批请求全部变慢。提速靠「减少请求数」（如专辑名预搜），
// 不靠提高并发。
const gatePools: Record<'critical' | 'cover', GatePool> = {
  critical: { cap: 2, active: 0, queue: [] },
  cover: { cap: 1, active: 0, queue: [] },
};

function gatePoolOf(config: any): GatePool {
  const url = String(config.url || '');
  return url.includes('get=pic') || url.includes('get=lrc') ? gatePools.cover : gatePools.critical;
}

function gatePriorityOf(config: any): number {
  const url = String(config.url || '');
  if (url.includes('get=url')) return 0;
  return 1;
}

async function acquireApiGate(config: any): Promise<() => void> {
  if (!isApiOriginRequest(config)) return () => {};
  const pool = gatePoolOf(config);
  if (pool.active < pool.cap) {
    pool.active++;
    return () => releaseApiGate(pool);
  }
  const priority = gatePriorityOf(config);
  const since = Date.now();
  await new Promise<void>((resolve) => {
    // 高优先级插到队首；同级保持 FIFO
    if (priority === 0) pool.queue.unshift({ priority, resolve, since });
    else pool.queue.push({ priority, resolve, since });
  });
  if (apiTimingLog) {
    const waited = Date.now() - since;
    if (waited > 2000) {
      const name = pool === gatePools.critical ? 'critical' : 'cover';
      console.log(`[apiGate] ${name} 排队 ${waited}ms (active=${pool.active} queue=${pool.queue.length}) ${String(config.url || '').slice(0, 60)}`);
    }
  }
  return () => releaseApiGate(pool);
}

function releaseApiGate(pool: GatePool): void {
  pool.active--;
  // 唤醒优先级最高的等待者（同优先级取最早入队的）
  let idx = -1;
  for (let i = 0; i < pool.queue.length; i++) {
    if (idx === -1 || pool.queue[i].priority < pool.queue[idx].priority) idx = i;
  }
  if (idx !== -1) {
    const w = pool.queue.splice(idx, 1)[0];
    // 槽位在同步块内直接转移给被唤醒者，避免新请求插队抢占
    pool.active++;
    w.resolve();
  }
}

const SODA_URL_CACHE_TTL = 10 * 60 * 1000;
const sodaAudioUrlCache = new Map<string, { url: string; expires: number }>();

/** 会话保护端点返回的错误页特征串（无会话时 api.php 一律返回此页） */
const INVALID_REQUEST_MARKER = '非法请求';
/** dev 诊断：API 请求耗时日志（>300ms 才打，避免刷屏；mobile __DEV__ 启用） */
let apiTimingLog = false;
export function setApiTimingLog(enabled: boolean): void {
  apiTimingLog = enabled;
}

// ── 上游限流观察器 ─────────────────────────────────────────────
// 上游服务端对同 IP 请求有窗口配额（超过后请求挂起直到超时，实测
// 连续 2-3 个请求后即开始挂起）。客户端必须自适应退避：core 在检测到
// 关键请求（搜索 POST / 播放直链解析）超时时通知宿主，宿主安排刷新暂停。
export type ThrottleEvent = 'throttle' | 'success';
let throttleObserver: ((event: ThrottleEvent) => void) | null = null;
export function setThrottleObserver(fn: ((event: ThrottleEvent) => void) | null): void {
  throttleObserver = fn;
}
function reportThrottleEvent(event: ThrottleEvent): void {
  try {
    throttleObserver?.(event);
  } catch {
    // 观察器异常不能影响请求链路
  }
}

// ── api.php 302 解析并发控制 ─────────────────────────────────────
// （已随 getAudioUrl/resolveCoverUrl 死方法删除，#275；apiClient/会话机件
// 的删除是下一票 #276）

export function setApiBaseUrl(url: string): void {
  API_BASE_URL = url ? (url.endsWith('/') ? url : url + '/') : '';
  apiClient.defaults.baseURL = API_BASE_URL;
  // 服务端可能更换，旧会话失效；远程源提前预热会话，避免首个请求多一次往返
  invalidateApiSession();
  // RN 下会话由常驻 WebView 桥托管：桥加载 API 首页时即完成引导（onLoad
  // 时 markApiSessionBootstrapped），这里再主动 GET 首页只会重复占用上游
  // 的请求配额（上游对同 IP 有严格窗口限制）。桌面端保留预热。
  if (isRemoteApiHost() && !IS_REACT_NATIVE) {
    void ensureApiSession();
  }
}
export function getApiBaseUrl(): string { return API_BASE_URL; }
export function setProxyUrl(url: string): void {
  PROXY_URL = url;
  if (url) {
    try {
      const parsed = new URL(url);
      apiClient.defaults.proxy = {
        host: parsed.hostname,
        port: parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
        protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
      };
    } catch { apiClient.defaults.proxy = false; }
  } else {
    apiClient.defaults.proxy = false;
  }
}
export function getProxyUrl(): string { return PROXY_URL; }

export interface ProxyAgents {
  httpAgent: Agent;
  httpsAgent: Agent;
}

let _proxyAgentsProvider: (() => ProxyAgents) | null = null;
export function injectProxyAgents(provider: () => ProxyAgents): void {
  _proxyAgentsProvider = provider;
  Object.defineProperty(apiClient.defaults, 'httpAgent', { get: () => _proxyAgentsProvider!().httpAgent, configurable: true });
  Object.defineProperty(apiClient.defaults, 'httpsAgent', { get: () => _proxyAgentsProvider!().httpsAgent, configurable: true });
}

const apiClient = axios.create({
  get baseURL() {
    return API_BASE_URL;
  },
  headers: {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest'
  },
  proxy: false,
  // 手机网络并发超过 5 后严重劣化（连接限速/重传），单请求 0.6s 即可完成；
  // 30s 超时会让慢源卡死整批，12s 足够覆盖慢网络又不至于无限等待
  timeout: 12000,
  // 显式开启 withCredentials：RN Android 的 NetworkingModule 只在
  // withCredentials=true 时启用 cookie jar（否则 CookieJar.NO_COOKIES），
  // axios 在 RN 的默认值有历史坑（PR #1441），显式指定保证原生栈
  // fallback 能携带会话 cookie（Android 上 jar 与 WebView CookieManager
  // 共享存储，桥引导的 PHPSESSID 原生栈可直接复用）。桌面/Node 无副作用。
  withCredentials: true,
  adapter: bridgeOrDefaultAdapter as any,
});

// ── 上游搜索服务会话管理 ────────────────────────────────────────
// 搜索/取歌接口要求携带 PHPSESSID 会话 cookie，否则一律返回
// {"code":404,"error":"没有找到相关信息"}（搜索）或「非法请求」（api.php）。
// 首次请求前先 GET 首页拿会话，之后所有同源请求自动带 Cookie；
// 会话失效时刷新并原样重试一次（搜索 404 / api.php 非法请求均视为失效信号）。
let apiSessionCookie = '';
let apiSessionFetching: Promise<string> | null = null;
// RN（Android）原生 OkHttp cookie jar 自动托管会话 cookie，JS 读不到
// Set-Cookie 响应头（被 RN networking 过滤）——此模式下 JS 只负责
// 引导一次首页请求建立 jar，不读取也不手动携带 cookie 值。
const IS_REACT_NATIVE =
  typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';
// RN 下「已引导 jar」标志：避免每个请求都重复 GET 首页
let apiSessionBootstrapped = false;

function invalidateApiSession(): void {
  apiSessionCookie = '';
  apiSessionBootstrapped = false;
}

/** 宿主（mobile WebView 桥）通知：首页已加载，会话引导完成 */
export function markApiSessionBootstrapped(): void {
  apiSessionBootstrapped = true;
}

/**
 * 桥透传：WebView 同源 document.cookie 里读到的会话 cookie。
 * RN 原生层过滤 Set-Cookie 响应头、JS 读不到值；但 WebView 里
 * document.cookie 可读（PHPSESSID 非 HttpOnly 时）——透传后 JS 层
 * 显式拿到 cookie 值，播放器/原生 fetch 可直接携带（iOS WKWebView
 * 与 NSURLSession 存储不同步的场景尤其需要）。
 */
export function setApiSessionCookieValue(cookie: string): void {
  const m = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('PHPSESSID='));
  if (m) {
    apiSessionCookie = m.slice('PHPSESSID='.length) || '';
    apiSessionBootstrapped = true;
  }
}

/** 当前会话 cookie 值（无则空串——cookie 由 jar/桥自动携带时 JS 拿不到值） */
export function getApiSessionCookie(): string {
  return apiSessionCookie;
}

function isRemoteApiHost(): boolean {
  try {
    const host = new URL(API_BASE_URL).hostname;
    return host !== '' && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch {
    return false;
  }
}

/** 判断 URL 是否发往 API 同源（cookie 只允许带上同源请求，避免泄漏给第三方 CDN） */
export function isApiOriginUrl(url: string): boolean {
  try {
    const base = new URL(API_BASE_URL);
    const target = new URL(url, API_BASE_URL);
    return target.origin === base.origin;
  } catch {
    return false;
  }
}

/** 判断请求配置是否发往 API 同源 */
function isApiOriginRequest(config: { url?: string; baseURL?: string }): boolean {
  try {
    return isApiOriginUrl(new URL(config.url || '', config.baseURL || API_BASE_URL).href);
  } catch {
    return false;
  }
}

async function ensureApiSession(): Promise<string> {
  if (apiSessionCookie) return apiSessionCookie;
  // 桥/原生 jar 已引导过就直接返回（cookie 由 jar 携带，JS 拿不到值）
  if (apiSessionBootstrapped) return '';
  if (!apiSessionFetching) {
    apiSessionFetching = (async () => {
      try {
        const origin = new URL(API_BASE_URL).origin;
        // 走 apiClient 以继承代理/agent 配置；__sessionBootstrapSkip 标记绕过会话拦截
        const res = await apiClient.get(origin + '/', {
          timeout: 8000,
          maxRedirects: 5,
          headers: {
            // 首页必须像普通浏览器访问，不能带 AJAX 特征头：
            // 带 x-requested-with 会被服务端当 AJAX 请求处理，返回 403 且会话不初始化，
            // 之后所有搜索都会因会话无效被拒（404 没有找到相关信息）
            'X-Requested-With': null,
            'Content-Type': null,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          __sessionBootstrapSkip: true,
        } as any);
        // 不同运行环境 headers['set-cookie'] 可能是数组或单条字符串，统一成数组
        const rawCookies = res.headers['set-cookie'];
        const setCookies: string[] = Array.isArray(rawCookies)
          ? rawCookies
          : rawCookies
            ? [rawCookies]
            : [];
        apiSessionCookie = setCookies.map(c => c.split(';')[0]).find(c => c.startsWith('PHPSESSID=')) || '';
        if (!apiSessionCookie) {
          if (!IS_REACT_NATIVE) {
            console.warn('[session] 首页未返回 PHPSESSID 会话 cookie，搜索可能被拒');
          }
          // RN：Set-Cookie 头被原生层过滤，cookie 由 OkHttp jar 自动携带
        }
        // 请求成功（无论能否读到 cookie 值）：jar 已引导，后续无需重复 GET 首页
        apiSessionBootstrapped = true;
      } catch (e: any) {
        console.warn('[session] 获取会话失败:', e?.message || e);
        // 失败允许下次重试（RN 下 jar 为空时请求必被拒，不能一次失败就放弃）
        apiSessionBootstrapped = false;
      } finally {
        apiSessionFetching = null;
      }
      return apiSessionCookie;
    })();
  }
  return apiSessionFetching;
}

// 请求拦截：API 同源请求自动带上会话 cookie（懒获取，去重并发）
apiClient.interceptors.request.use(async (config) => {
  const ext = config as any;
  if (ext.__sessionBootstrapSkip || ext.__sessionRetried) return config;
  if (!isApiOriginRequest(config)) return config;
  if (apiTimingLog) (config as any).__t0 = Date.now();
  try {
    const cookie = await ensureApiSession();
    if (cookie) config.headers.set('Cookie', cookie);
  } catch {
    // 会话获取失败不阻塞请求，保持原有失败兜底行为
  }
  return config;
});

// 响应拦截：会话缺失/失效时刷新会话并重试一次
apiClient.interceptors.response.use(
  async (response) => {
    const config = response.config as any;
    if (apiTimingLog && config?.__t0 && !config.__probe) {
      const ms = Date.now() - config.__t0;
      if (ms > 300) {
        const method = (config.method || 'get').toUpperCase();
        console.log(`[api耗时] ${method} ${String(config.url).slice(0, 70)}: ${ms}ms`);
      }
    }
    if (config.__sessionBootstrapSkip || config.__sessionRetried) return response;
    if (!isApiOriginRequest(config)) return response;

    // 关键请求成功 = 上游未限流，重置退避（封面 3s 快超时不算，避免误报）
    // 探测请求（__probe）高频且可能探测 get=url 端点，不计入退避统计
    const method = (config.method || 'get').toLowerCase();
    if (!config.__probe && (method === 'post' || String(config.url || '').includes('get=url'))) {
      reportThrottleEvent('success');
    }

    const data: unknown = response.data;

    // 搜索接口（POST 根路径）：code 404「没有找到相关信息」= 会话缺失/失效
    const noSessionSearch =
      method === 'post' &&
      data !== null &&
      typeof data === 'object' &&
      (data as any).code === 404 &&
      typeof (data as any).error === 'string' &&
      ((data as any).error as string).includes('没有找到相关信息');

    // api.php（GET）：返回「非法请求」= 会话缺失/失效（id 无效也会如此，重试一次无副作用）。
    // arraybuffer 响应（探测/302 解析）也检测：无 cookie 的探测会拿错误页，
    // 不刷新会话重试的话探测结果失真（全 invalid/preview）
    const noSessionApi =
      method === 'get' &&
      (typeof data === 'string'
        ? data.includes(INVALID_REQUEST_MARKER)
        : data instanceof ArrayBuffer
          ? new TextDecoder('utf-8').decode(new Uint8Array(data.slice(0, 1024))).includes(INVALID_REQUEST_MARKER)
          : false);

    if (noSessionSearch || noSessionApi) {
      invalidateApiSession();
      const cookie = await ensureApiSession();
      // RN：cookie 由原生 jar 携带，JS 拿不到值但首页 GET 已重建 jar，
      // 无条件重试一次；其他环境要求 JS 确实拿到新 cookie 才重试
      if (cookie || IS_REACT_NATIVE) {
        config.__sessionRetried = true;
        if (cookie) config.headers.set('Cookie', cookie);
        return apiClient.request(config);
      }
      console.warn('[session] 会话刷新失败，返回原始响应');
    }
    return response;
  },
  (error) => {
    const config = error?.config as any;
    if (apiTimingLog && config?.__t0) {
      const ms = Date.now() - config.__t0;
      const method = (config.method || 'get').toUpperCase();
      console.log(`[api耗时] ${method} ${String(config.url).slice(0, 70)}: ${ms}ms (${error?.message})`);
    }
    // 超时 = 上游限流挂起的典型信号；只统计关键请求（搜索 POST / 播放直链），
    // 封面/歌词 3s 快超时是常态，不计入退避
    const timedOut =
      error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''));
    if (timedOut && config && isApiOriginRequest(config) && !config.__probe) {
      const method = String(config.method || 'get').toLowerCase();
      if (method === 'post' || String(config.url || '').includes('get=url')) {
        reportThrottleEvent('throttle');
      }
    }
    return Promise.reject(error);
  }
);

export function getApiClient(): AxiosInstance {
  return apiClient;
}

/**
 * 从 api.php 端点 URL 的 type 参数推断源，返回该源官方站点 Referer。
 * 302 解析 fetch 跟随重定向到源 CDN 时，CDN 防盗链会校验 Referer 域名：
 * 网易云宽松（不带也行），酷狗/QQ 等严格（Referer 不对 → 403 → 拿不到
 * 直链/播放失败）。fetch 默认 referrerPolicy 在跨源重定向时把 Referer
 * 降级为 origin（API 域名），CDN 不认——必须手动带官方 Referer。
 */
// BROWSER_UA / 按源 Referer 映射见 utils/sourceReferer.ts（core 共享，
// musicApi / audioProbe / 播放器统一一份，避免 key 形状不一致漏配）

/**
 * 歌词响应体归一化（T06 #152）：QQ fcg 歌词端点返回 JSON，`lyric` 字段为
 * base64 编码的 LRC 文本 → 解码为 LRC；非 JSON / 无 lyric 字段原样返回。
 * 纯函数，独立导出供测试。
 */
export function decodeLyricBody(body: unknown): string {
  if (typeof body !== 'string') return '';
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return body;
  try {
    const parsed = JSON.parse(trimmed) as { lyric?: unknown };
    if (typeof parsed.lyric === 'string' && parsed.lyric.length > 0) {
      const decoded = decodeBase64(parsed.lyric);
      if (decoded) return decoded;
    }
  } catch {
    // 非 JSON：按原样返回
  }
  return body;
}

function decodeBase64(input: string): string {
  return decodeBase64Utf8(input);
}

/**
 * 补全 URL，确保返回完整的绝对 URL
 * @param url 可能是相对路径或绝对 URL
 * @returns 完整的绝对 URL
 */
function normalizeUrl(url: string | undefined): string {
  if (!url) return '';

  // 如果已经是完整的 URL（以 http:// 或 https:// 开头），直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // 如果是以 // 开头的协议相对 URL，添加 https:
  if (url.startsWith('//')) {
    return 'https:' + url;
  }

  // 如果是相对路径，拼接 API_BASE_URL
  if (url.startsWith('/')) {
    return API_BASE_URL + url.slice(1);
  }

  // 其他情况直接拼接
  return API_BASE_URL + url;
}

// 热榜歌曲类型
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

/**
 * QQ v8 榜单单曲 → HotlistSong（#172）。
 * id **优先取 songmid**：GetVkey 直连腿按 songmid 键控，数字 id 走直连恒为空
 * （与无版权/VIP 无关），整榜 100% 依赖 tier3、探测预取全部无效。
 * 数字 id 仅在响应缺失 mid 时兜底。封面用 album.mid 构建（同接口约定）。
 */
export function mapQQToplistItem(item: any, index: number): HotlistSong | null {
  const songData = item?.data;
  if (!songData) return null;
  const artists = songData.singer?.map((singer: any) => singer.name).join('/') || '';
  const albumMid = songData.album?.mid || '';
  return {
    id: songData.mid || songData.id?.toString() || '',
    name: songData.name || '',
    artists,
    rank: index + 1,
    cover: albumMid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}_1.jpg`
      : '',
    album: songData.album?.name || ''
  };
}

/** 汽水分享页结构化歌词单字（sentences[].words[] 项，行内逐字时间轴）。 */
export interface SodaLyricWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** 汽水分享页结构化歌词行（sentences[] 项，type=krc/lrc）。 */
export interface SodaLyricSentence {
  startMs: number;
  endMs: number;
  text: string;
  /** 逐字时间轴；缺省/为空时行文本取整句 text。 */
  words?: SodaLyricWord[];
  type?: string;
}

/**
 * 汽水分享页结构化歌词（sentences[]）→ LRC 文本（纯函数，可单测）。
 * 输入为分享页 _ROUTER_DATA.audioWithLyricsOption.lyrics.sentences。
 * 行文本取 words[].text 拼接（回退整句 text）；时间轴 [mm:ss.xxx]。
 */
export function sodaSentencesToLrc(sentences: SodaLyricSentence[] | null | undefined): string {
  if (!Array.isArray(sentences) || sentences.length === 0) return '';
  const lines: string[] = [];
  for (const s of sentences) {
    if (typeof s?.startMs !== 'number') continue;
    const text =
      Array.isArray(s.words) && s.words.length > 0
        ? s.words.map((w) => w?.text ?? '').join('')
        : s.text ?? '';
    if (!text.trim()) continue;
    const ms = s.startMs;
    const mm = Math.floor(ms / 60000);
    const ss = Math.floor((ms % 60000) / 1000);
    const xxx = ms % 1000;
    lines.push(`[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xxx).padStart(3, '0')}]${text}`);
  }
  return lines.join('\n');
}

export const musicApi = {
  /**
   * 构建汽水音乐封面 URL
   */
  sodaBuildImageUrl(urlCover: { urls?: string[]; uri?: string } | undefined): string {
    if (!urlCover || !urlCover.urls || urlCover.urls.length === 0) return '';
    let cover = (urlCover.urls[0] || '').trim();
    const uri = (urlCover.uri || '').trim();
    if (uri && !cover.includes(uri)) cover += uri;
    if (cover && !cover.includes('~')) cover += '~c5_375x375.jpg';
    return cover;
  },

  /**
   * 搜索汽水音乐 (直接调用 api.qishui.com)
   * 注：搜索结果不含 audio_url，播放/探测时会通过 trackId 单独解析直链
   */
  async searchSongsSoda(keyword: string, page: number = 1): Promise<Song[]> {
    const cacheKey = `soda_search_${keyword}_${page}`;
    const cached = cacheManager.getSearchCache(cacheKey, page, 'soda');
    if (cached) return cached;

    const params = new URLSearchParams();
    params.set('q', keyword);
    params.set('cursor', String((page - 1) * 20));
    params.set('search_method', 'input');
    params.set('aid', '386088');
    params.set('device_platform', 'web');
    params.set('channel', 'pc_web');

    // 路径要点：luna/search/track（无 pc 段）。旧 luna/pc/search/track 返回 200 空 body（接口已改版），
    // 无 pc 段的路径免登录可用（2026-08 实测：大陆 IP 直连返回完整 result_groups）。
    const apiURL = 'https://api.qishui.com/luna/search/track?' + params.toString();
    const res = await request({
      method: 'GET',
      url: apiURL,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      },
      timeoutMs: 15000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`汽水搜索 HTTP ${res.status}`);
    }
    const data = JSON.parse(bodyToText(res.body)) as {
      result_groups?: { data?: { entity?: { track?: any } }[] }[];
    };
    const songs: Song[] = [];

    if (data.result_groups && data.result_groups.length > 0) {
      for (const item of data.result_groups[0].data || []) {
        const track = item.entity?.track;
        if (!track || !track.id) continue;

        const artist = (track.artists || []).map((a: { name: string }) => a.name).join(' / ');
        const cover = this.sodaBuildImageUrl(track.album?.url_cover);
        const albumName = track.album?.name || '';
        const duration = track.duration ? Math.floor(track.duration / 1000) : 0;

        songs.push({
          id: track.id,
          name: track.name || '',
          artist,
          album: albumName,
          url: '',
          cover,
          lrc: '',
          duration,
          sourceType: 'soda',
        });
      }
    }

    cacheManager.setSearchCache(cacheKey, page, 'soda', songs);
    return songs;
  },


  /**
   * 解析汽水分享页（music.douyin.com/qishui/share/track，免登录）。
   *
   * _ROUTER_DATA.audioWithLyricsOption 同时含：
   * - url：音频直链（encrypt=false，未加密；付费歌为试听段）
   * - lyrics.sentences[]：结构化歌词（startMs/endMs/text/words，lyricType=krc），
   *   免登录即可拿，无需 track_v2 的登录态 Cookie
   * - trackInfo.duration：权威完整时长（ms），供探测 resolveUrlInfo 时长校验
   *
   * 返回 lyrics 为 LRC 文本（[mm:ss.xxx]行），无歌词返回空串。
   */
  async fetchSodaSharePage(trackId: string): Promise<{
    audioUrl: string;
    name: string;
    artist: string;
    cover: string;
    lyrics: string;
    durationMs: number;
  } | null> {
    const shareUrl = `https://music.douyin.com/qishui/share/track?track_id=${trackId}`;
    try {
      const response = await axios.get(shareUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      });
      const html = response.data;
      const match = html.match(/_ROUTER_DATA\s*=\s*({[\s\S]*?});/);
      if (!match) return null;
      const data = JSON.parse(match[1], (_key, value) => {
        if (_key === '__proto__' || _key === 'constructor' || _key === 'prototype') {
          return undefined;
        }
        return value;
      });
      const audio = data?.loaderData?.track_page?.audioWithLyricsOption;
      if (!audio?.url) return null;

      // 结构化歌词 → LRC 文本（sodaSentencesToLrc 纯函数，可单测）
      const sentences = audio?.lyrics?.sentences;
      const lyrics = sodaSentencesToLrc(sentences);

      return {
        audioUrl: decodeURIComponent(audio.url),
        name: audio.trackName || '',
        artist: audio.artistName || '',
        cover: audio.coverURL || '',
        lyrics,
        // trackInfo.duration 为权威完整时长（ms），供探测 resolveUrlInfo 时长校验
        // （playTime）；audio.duration 为浮点秒，两者一致
        durationMs: typeof audio?.trackInfo?.duration === 'number' ? audio.trackInfo.duration : 0,
      };
    } catch {
      return null;
    }
  },

  /**
   * 获取汽水音乐音频直链（用于下载）
   * 优先用分享页 _ROUTER_DATA（无需Cookie），fallback 到 track_v2
   */
  async getSodaAudioUrl(trackId: string): Promise<string> {
    const cached = sodaAudioUrlCache.get(trackId);
    if (cached && cached.expires > Date.now()) return cached.url;

    const page = await this.fetchSodaSharePage(trackId);
    if (page?.audioUrl) {
      this.cacheSodaAudioUrl(trackId, page.audioUrl);
      return page.audioUrl;
    }

    // 注意：track_v2 匿名请求 2026-08 实测返回 200 空 body（需 PC 客户端登录态
    // Cookie，见 CONTEXT.md「汽水歌词」），下述 fallback 基本必空，保留仅为历史
    // 兼容（若未来接入登录态凭证可复用此段）；分享页失败时返回 '' 由调用方兜底。
    const params = new URLSearchParams();
    params.set('track_id', trackId);
    params.set('media_type', 'track');
    params.set('aid', '386088');
    params.set('device_platform', 'web');
    params.set('channel', 'pc_web');

    const apiURL = 'https://api.qishui.com/luna/pc/track_v2?' + params.toString();
    try {
      const response = await axios.get(apiURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      });

      const data = response.data;
      const track = data.track || data.track_info;
      if (!track) return '';

      const playInfoList = track.audio_info?.play_info_list || [];
      if (playInfoList.length === 0) return '';

      const best = playInfoList.reduce((a: any, b: any) =>
        (a.size || 0) > (b.size || 0) ? a : b
      );
      const audioUrl = best.main_play_url || best.backup_play_url || '';
      if (!audioUrl) return '';

      const auth = best.play_auth || '';
      const result = auth ? `${audioUrl}?play_auth=${encodeURIComponent(auth)}` : audioUrl;
      this.cacheSodaAudioUrl(trackId, result);
      return result;
    } catch (error) {
      console.error('获取汽水音乐音频 URL 失败:', error);
      return '';
    }
  },

  /**
   * 获取汽水音乐歌词（分享页免登录结构化歌词 → LRC 文本）。
   * 分享页 audioWithLyricsOption.lyrics.sentences 已是结构化时间轴，
   * 无需 track_v2 的登录态 Cookie；无歌词返回空串。
   */
  async getSodaLyrics(trackId: string): Promise<string> {
    if (!trackId) return '';
    const cacheKey = `soda_lyric_${trackId}`;
    const cached = cacheManager.getLyricsCache(cacheKey);
    if (cached !== null) return cached;
    try {
      const page = await this.fetchSodaSharePage(trackId);
      const lyrics = page?.lyrics || '';
      if (lyrics) cacheManager.setLyricsCache(cacheKey, lyrics);
      return lyrics;
    } catch {
      return '';
    }
  },

  cacheSodaAudioUrl(trackId: string, url: string): void {
    // 顺带清理过期项，防 Map 无界增长（每首歌一个 entry，长期会话会积累）
    if (sodaAudioUrlCache.size >= 500) {
      const now = Date.now();
      for (const [k, v] of sodaAudioUrlCache) {
        if (v.expires < now) sodaAudioUrlCache.delete(k);
      }
    }
    sodaAudioUrlCache.set(trackId, { url, expires: Date.now() + SODA_URL_CACHE_TTL });
  },

  /**
   * 解析汽水音乐分享链接，返回歌曲信息
   * 原理：抓分享页 HTML，提取 _ROUTER_DATA JSON，获取歌曲信息 + 音频直链
   * 支持格式：https://qishui.douyin.com/s/xxx 和 https://music.douyin.com/qishui/share/track?track_id=xxx
   */
  async parseSodaShareLink(link: string): Promise<Song | null> {
    try {
      // SSRF 防护：仅允许汽水音乐/抖音域名
      const allowedHosts = ['qishui.douyin.com', 'music.douyin.com'];
      const url = new URL(link);
      if (!allowedHosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
        throw new Error('不支持的链接域名');
      }

      const response = await axios.get(link, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        maxRedirects: 10,
        timeout: 15000,
      });

      const html = response.data;
      const match = html.match(/_ROUTER_DATA\s*=\s*({[\s\S]*?});/);
      if (!match) return null;

      const data = JSON.parse(match[1], (_key, value) => {
        if (_key === '__proto__' || _key === 'constructor' || _key === 'prototype') {
          return undefined;
        }
        return value;
      });
      const audio = data?.loaderData?.track_page?.audioWithLyricsOption;
      if (!audio || !audio.trackName) return null;

      const trackInfo = audio.trackInfo || {};
      const album = trackInfo.album || {};
      const cover = audio.coverURL || '';
      const audioUrl = audio.url ? decodeURIComponent(audio.url) : '';
      const artistName = audio.artistName || '';
      const albumName = album.name || '';
      const trackId = data?.loaderData?.track_page?.track_id || trackInfo.id || '';

      return {
        id: String(trackId),
        name: audio.trackName || '',
        artist: artistName,
        album: albumName,
        url: audioUrl,
        cover,
        lrc: '',
        duration: trackInfo.duration ? Math.floor(trackInfo.duration / 1000) : 0,
        sourceType: 'soda',
      };
    } catch (error) {
      console.error('解析汽水音乐分享链接失败:', error);
      return null;
    }
  },

  async getLyrics(lrcUrl: string): Promise<string> {
    const fullUrl = normalizeUrl(lrcUrl);
    if (!fullUrl) return '';

    // 尝试从缓存获取
    const cachedData = cacheManager.getLyricsCache(fullUrl);
    if (cachedData) {
      return cachedData;
    }

    // 第三方歌词 URL（QQ fcg / 酷我 newlyric / 酷狗两步）需要浏览器 UA + 官方 Referer，
    // 否则 CDN 防盗链会因 axios 默认 UA / 缺 Referer 返回 403 或空响应。
    const referer = refererForUrl(fullUrl);
    const isKuwoLyric = fullUrl.includes('newlyric.kuwo.cn');
    const isKugouLyric = fullUrl.includes('lyrics.kugou.com/search');
    const isQQFcgLyric = /c\.y\.qq\.com\/lyric\//i.test(fullUrl);
    const lyricHeaders: Record<string, string> = {};
    if (referer) lyricHeaders['Referer'] = referer;
    if (isKuwoLyric || isKugouLyric || isQQFcgLyric) {
      lyricHeaders['User-Agent'] = BROWSER_UA;
    }
    let lyrics: string;
    if (isKugouLyric) {
      // 酷狗歌词是两步接口：search → download。这里不要再先 GET 一次 search URL，
      // 直接交给 resolveKugouLyricUrl 走完整链路，避免多余请求导致 403/失败。
      lyrics = await resolveKugouLyricUrl(fullUrl);
    } else {
      try {
        const response = await apiClient.get(fullUrl, {
          headers: lyricHeaders,
          responseType: isKuwoLyric ? 'arraybuffer' : 'text',
        });
        // 酷我：tp=content + zlib + XOR + gb18030 管线；其余走 JSON/base64 或原样
        lyrics = isKuwoLyric
          ? decodeKuwoLyricBody(new Uint8Array(response.data))
          : decodeLyricBody(response.data);
      } catch (e) {
        if (!isQQFcgLyric) throw e;
        lyrics = ''; // QQ：GET 失败（网络/超时）同样落网关兜底
      }
      // QQ fcg GET 强制 Referer 防盗链（缺 Referer 返回 retcode=-1310 拒绝体，
      // 解不出 LRC）；桌面 Chromium/Node 栈带得上 Referer，RN 网络栈真机被拒。
      // 被拒时改走 musicu 网关取词（与搜索/GetVkey 同通道，无 Referer 校验）。
      if (isQQFcgLyric && !looksLikeLyrics(lyrics)) {
        const songmid = /[?&]songmid=([^&]+)/.exec(fullUrl)?.[1] || '';
        console.info(`[lyrics] QQ fcg GET 未拿到歌词，musicu 网关兜底 songmid=${songmid}`);
        const viaGateway = songmid ? await fetchLyricViaGateway(songmid).catch(() => '') : '';
        if (looksLikeLyrics(viaGateway)) lyrics = viaGateway;
      }
    }

    // 会话失效/签名过期：服务端返回「非法请求」页（200 text/html；响应拦截器
    // 已带新会话重试一次仍无效——签名与旧会话绑定，同 URL 重试无意义）。
    // 按失败抛出让上层走搜索换新签名 URL 重试，否则 parseLRC 拿到空行会
    // 静默显示"无歌词"，歌词永远刷新不出来（移动端实测现象）。
    if (typeof lyrics === 'string' && lyrics.includes(INVALID_REQUEST_MARKER)) {
      throw new Error('歌词会话失效（非法请求），需重新搜索歌词 URL');
    }

    // 只缓存真正的 LRC；错误页/JSON 错误体/无时间戳内容不缓存、按无歌词返回，
    // 避免之前失败的坏结果把同一 lrc URL 卡在内存缓存里，导致修复后仍显示暂无歌词。
    if (!looksLikeLyrics(lyrics)) {
      return '';
    }

    // 缓存结果
    cacheManager.setLyricsCache(fullUrl, lyrics);
    return lyrics;
  },

    /**
   * QQ 音乐排行榜通用方法
   * @param topid 榜单 ID（热歌榜 26，新歌榜 27）
   * @param cacheKey 缓存键
   */
  async getQQToplist(topid: number, cacheKey: string): Promise<HotlistSong[]> {
    const cachedData = cacheManager.getHotlistCache(cacheKey);
    if (cachedData && cachedData.length > 0) {
      return cachedData;
    }

    try {
      // 获取当前日期，格式为 YYYY-MM-DD
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      // 使用旧 API 端点获取 albummid，用于构建封面 URL
      const url = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?newsong=1&tpl=3&page=detail&date=${dateStr}&topid=${topid}&type=top&song_begin=0&song_num=100&g_tk=5381&format=json&inCharset=utf-8&outCharset=utf-8&notice=0`;

      await beforeRequest();
      const qqClient = axios.create({
        headers: {
          ...getAntiScrapeHeaders('https://y.qq.com/'),
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://y.qq.com/',
        },
        timeout: 30000,
    proxy: false,
        responseType: 'text'
      });

      let response = await qqClient.get(url);
      let data = response.data;

      // 确保数据是字符串类型
      let dataStr = typeof data === 'string' ? data : JSON.stringify(data);

      // 解析JSON格式的数据
      let jsonData = JSON.parse(dataStr);

      // 如果今天的数据还没有更新（code不为0），尝试使用昨天的日期
      if (jsonData.code !== 0) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const yesterdayUrl = url.replace(dateStr, yesterdayStr);
        response = await qqClient.get(yesterdayUrl);
        data = response.data;
        dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        jsonData = JSON.parse(dataStr);
      }

      // 检查songlist字段
      const songlist = jsonData.songlist || [];

      if (!Array.isArray(songlist)) {
        throw new Error(`无法解析QQ音乐排行榜数据 (topid=${topid})，songlist不是数组`);
      }

      // 转换为热榜歌曲格式
      const hotlistSongs: HotlistSong[] = [];

      for (let index = 0; index < songlist.length; index++) {
        // 映射失败的单曲跳过（与原内联 try/catch 语义一致）
        const mapped = mapQQToplistItem(songlist[index], index);
        if (mapped) hotlistSongs.push(mapped);
      }

      // 缓存结果
      cacheManager.setHotlistCache(cacheKey, hotlistSongs);
      return hotlistSongs;
    } catch (error) {
      console.error(`获取QQ音乐排行榜失败 (cacheKey=${cacheKey}):`, error);
      return [];
    }
  },

  async getQQHotlist(): Promise<HotlistSong[]> {
    return this.getQQToplist(26, 'qq');
  },

  async getQQNewSongList(): Promise<HotlistSong[]> {
    return this.getQQToplist(27, 'qq_new');
  },

  groupIntoSongGroups(allSongs: Song[]): SongGroup[] {
    return groupIntoSongGroupsUtil(allSongs);
  },

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams();
      params.append('input', '稻香');
      params.append('filter', 'name');
      params.append('type', 'netease');
      params.append('page', '1');
      // 探测用短超时:API 慢时快速失败,不拖慢页面加载
      const response = await apiClient.post('', params, { timeout: 3000 });
      const data = response.data?.data;
      return Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  },

  /**
   * 批量探测歌曲可播性（桌面换源/搜索结果探测），空 url → `invalid`。
   * 复用 core `probeSongs` + `getAudioUrl` resolver：每首先解析直链再探测。
   */
  async probeSongsBatch(songs: Song[]): Promise<{ songId: string; tag: AudioTag }[]> {
    const list = Array.isArray(songs) ? songs : [];
    if (list.length === 0) return [];
    const results: { songId: string; tag: AudioTag }[] = [];
    // 记录每首解析后的最终 URL + 直连 nonFull 判定（空 → invalid，保持桌面现状）
    const resolvedUrls = new Map<string, { url: string; nonFull: boolean }>();
    const songsById = new Map(list.map((s) => [s.id, s]));
    await probeSongs(list, {
      concurrency: Math.min(5, Math.max(1, list.length)),
      resolver: async (song) => {
        let url = song.url;
        let nonFull = false;
        try {
          // 探测只走**直连**路由（resolvePlayableSongDirect，无 tier3）：
          // 探测语义 = 「直连可播性」，单请求/首、快，且不占用 tier3 上游配额、
          // 不被 mgmp3 等慢源（20s 超时）拖死整批探测（标签秒出）。
          // 播放仍走 resolvePlayableSongRouted（含 tier3 兜底）。
          const routed = await routedResolveSongDirect(song);
          if (routed?.url?.startsWith('http')) {
            url = routed.url;
            nonFull = routed.nonFull;
          }
        } catch {
          // keep the original URL; probeAudioUrl will classify it
        }
        resolvedUrls.set(song.id, { url: url || '', nonFull });
        return url;
      },
      onResult: (songId, tag) => {
        const entry = resolvedUrls.get(songId);
        results.push({ songId, tag: entry?.url ? tag : 'invalid' });
        // 探测职责转型：打标签的同时把直连直链写入预取缓存（主进程内存，
        // TTL 30min）——播放时 resolvePlayableSongRouted 先查缓存，命中 0 等待。
        const target = songsById.get(songId);
        if (target && entry?.url) {
          rememberProbeResult(target, entry.url, tag, entry.nonFull);
        }
      },
    });
    return results;
  },

  /**
   * 模式感知搜索（来源开关 auto/direct/api，单一回退链：直连 → 自建 API）。
   * 供 SearchOrchestrator 的 searchOneSource 注入（桌面经 musicApi:call 契约，
   * 移动端 core 直调）。直连客户端由 T02+ 各源 ticket 注册。
   */
  searchSongsRouted: (query: string, page: number, source: SourceKey) =>
    routedSearchSongs(query, page, source),

  /** 模式感知播放 URL 解析（请求层回退链 URL 腿；无版权/VIP 返回 '' 交换元层）。 */
  resolvePlayableUrlRouted: (song: Song) => routedResolveUrl(song),

  /** 模式感知播放解析 + 试听版检测（T12：UrlInfo 完整时长校验 → nonFull 标记）。 */
  resolvePlayableSongRouted: (song: Song) => routedResolveSong(song),
};
