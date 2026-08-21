import axios, { type AxiosInstance } from 'axios';
import type { Song, SourceKey, SongGroup, DiscoverPlaylist, Album, AudioTag } from '../types/index.js';
import { cacheManager } from './memoryCacheManager.js';
import { beforeRequest, getAntiScrapeHeaders } from './antiScrape.js';
import { weapiRequest } from './neteaseWeapi.js';
import { findExactMatch } from '../utils/songMatcher.js';
import { resourceUrlKey } from '../utils/resourceKey.js';
import { BROWSER_UA, refererForUrl } from '../utils/sourceReferer.js';
import { decodeBase64Utf8 } from '../utils/base64.js';
import { looksLikeLyrics } from '../download/lyrics.js';
import { request, bodyToText } from './transport.js';
import { stripSourceIdPrefix } from '../shared/resolvePlayableUrl.js';
import { groupIntoSongGroups as groupIntoSongGroupsUtil } from '../utils/groupIntoSongGroups.js';
import { probeSongs } from './probeSongs.js';
import { rememberProbeResult } from './prefetchCache.js';
import {
  searchSongsRouted as routedSearchSongs,
  resolvePlayableUrlRouted as routedResolveUrl,
  resolvePlayableSongRouted as routedResolveSong,
  resolvePlayableSongDirect as routedResolveSongDirect,
  configureSourceRouter,
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

const ALBUMS_CACHE_TTL = 60 * 60 * 1000;
const RECOMMENDED_CACHE_TTL = 15 * 60 * 1000;
const SODA_URL_CACHE_TTL = 10 * 60 * 1000;
const COVER_URL_CACHE_TTL = 6 * 60 * 60 * 1000;
const sodaAudioUrlCache = new Map<string, { url: string; expires: number }>();
const coverUrlCache = new Map<string, { url: string; expires: number }>();

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
// RN 连接池默认仅 5 个连接/主机：搜索结果页 30+ 首歌同时解析封面
// （api.php?get=pic）会把连接池排队打满，每个请求都 5s 超时，
// 连播放 URL 的解析也被拖死。限 3 并发 + 相同 URL in-flight 去重
// （同一首歌的封面/URL 并发请求合并为一个，避免重复打上游）。
// 注意：全局 API 闸门（API_GATE_CAP=3）才是最终并发上限，此处只是外层池。
const resolveWaiters: { priority: boolean; resolve: () => void }[] = [];
let resolveActive = 0;
const RESOLVE_MAX_CONCURRENCY = 3;
const resolveInflight = new Map<string, Promise<{ finalUrl: string; data: unknown }>>();

// 302 解析超时（毫秒）：封面 3s 快超时（失败有占位图兜底），播放直链 12s
// （弱网下 api.php 响应 1-15s，宁等多等也要真直链）
const COVER_RESOLVE_TIMEOUT_MS = 3000;
const AUDIO_RESOLVE_TIMEOUT_MS = 12000;

function runResolve(
  url: string,
  timeout: number,
  priority = false,
): Promise<{ finalUrl: string; data: unknown }> {
  const existing = resolveInflight.get(url);
  if (existing) return existing;
  const task = (async () => {
    if (resolveActive >= RESOLVE_MAX_CONCURRENCY) {
      await new Promise<void>((r) => {
        // 播放 URL 解析优先：插到等待队列最前，槽位一释放立即执行；
        // 封面解析排队（失败有占位图兜底，不阻塞播放）
        const waiter = { priority, resolve: r };
        if (priority) resolveWaiters.unshift(waiter);
        else resolveWaiters.push(waiter);
      });
    }
    resolveActive++;
    try {
      return await followRedirectsToFinalUrl(url, undefined, timeout);
    } finally {
      resolveActive--;
      // 唤醒下一个等待者。注意：shift() 已移除队首，不能再 splice——
      // indexOf 找不到时 splice(-1,1) 会误删队尾等待者（回归测试抓到：
      // 队列 ≥2 时最后一个封面永久挂起，不 resolve 也不超时）。
      const prio = resolveWaiters.find((w) => w.priority);
      if (prio) {
        resolveWaiters.splice(resolveWaiters.indexOf(prio), 1);
        prio.resolve();
      } else {
        resolveWaiters.shift()?.resolve();
      }
      resolveInflight.delete(url);
    }
  })();
  resolveInflight.set(url, task);
  return task;
}
/** 会话保护端点的 URL 特征（api.php?get=url / get=pic / get=lrc） */
export function isSessionProtectedEndpoint(url: string): boolean {
  return url.includes('api.php');
}
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

// 歌手头像缓存，供分类 tab 爬取时补图
const artistPicCache = new Map<string, string>();

// 搜索兜底状态:healthCheck 结果缓存(5 分钟)+ 搜索无结果歌曲黑名单(带 TTL)
// 黑名单用 Map<id, 时间戳> 而非 Set:瞬时故障(超时/502)不能永久拉黑,10 分钟后重试
const HEALTH_CHECK_TTL = 5 * 60 * 1000;
const SEARCH_FAILED_TTL = 10 * 60 * 1000;
let healthCheckCache = { at: 0, ok: false };
const searchFailedSongIds = new Map<string, number>();

// 网易云歌手分类 cat id → weapi artist/list 的 type/area 参数
// type: 1 男, 2 女, 3 乐队;area: 7 华语, 96 欧美, 8 日本(仅列出本项目用到的分类)
const NETEASE_CAT_MAP: Record<number, { type: number; area: number }> = {
  1001: { type: 1, area: 7 },  // 华语男
  1002: { type: 2, area: 7 },  // 华语女
  1003: { type: 3, area: 7 },  // 华语组合
  2001: { type: 1, area: 96 }, // 欧美男
  2002: { type: 2, area: 96 }, // 欧美女
  2003: { type: 3, area: 96 }, // 欧美组合
  6001: { type: 1, area: 8 },  // 日本
};

/** 预热热门歌手头像缓存 (top 100)，供 HTML 爬取分类歌手时补图 */
export async function warmUpArtistPicCache(): Promise<void> {
  if (artistPicCache.size > 50) return;
  try {
    const neteaseClient = createNeteaseClient();
    const res = await neteaseClient.get('https://music.163.com/api/v1/artist/list?offset=0&limit=100&initial=-1');
    const rawArtists: any[] = res.data?.artists || [];
    for (const a of rawArtists) {
      const picUrl = a.picUrl || a.img1v1Url || '';
      if (picUrl && !artistPicCache.has(a.name)) artistPicCache.set(a.name, picUrl);
    }
  } catch (e) {
    console.error('[warmUpArtistPicCache] 预热失败:', e);
  }
}

function createNeteaseClient() {
  return axios.create({
    headers: {
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://music.163.com/',
    },
    timeout: 30000,
    proxy: false,
  });
}

/** 兜底:旧接口(无加密)获取网易云歌单,返回 playlist 对象或 null */
async function fetchNeteasePlaylistLegacy(playlistId: number): Promise<any | null> {
  const neteaseClient = createNeteaseClient();
  const response = await neteaseClient.get(`https://music.163.com/api/playlist/detail?id=${playlistId}`);
  const p = response.data.result || response.data.playlist;
  return p || null;
}

/**
 * 网易云歌曲字段统一映射(兼容两套字段形状)
 * - weapi: ar / al / dt(毫秒)
 * - 旧接口: artists / album / duration(毫秒)
 */
function processNeteaseTrack(song: any): Song {
  const artists = song.ar || song.artists || [];
  const album = song.al || song.album || {};
  return {
    id: String(song.id),
    name: song.name || '',
    artist: artists.map((a: any) => a.name || '').filter(Boolean).join(' / '),
    album: album.name || '',
    url: '',
    cover: (album.picUrl || '').replace(/^http:/, 'https:'),
    lrc: '',
    duration: song.dt ? Math.floor(song.dt / 1000) : Math.floor((song.duration || 0) / 1000) || 0,
    sourceType: 'netease' as const,
  };
}

function normalizeNeteaseAlbum(raw: any): Album {
  // weapi 返回 artist 单对象,旧接口返回 artists 数组;兼容两种形状
  const rawArtist = raw.artists || raw.artist || [];
  const artistList = Array.isArray(rawArtist) ? rawArtist : [rawArtist];
  const artist = artistList.map((a: any) => a?.name || '').filter(Boolean).join(' / ') || '';

  return {
    id: String(raw.id),
    name: raw.name || raw.album?.name || '',
    picUrl: raw.picUrl || raw.album?.picUrl || raw.coverImgUrl || '',
    artist,
    publishTime: raw.publishTime || raw.publish_time || '',
  };
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
 * 手动逐跳跟随重定向，返回最终 URL 和末跳响应数据。
 * 当前 axios 版本的 response.request 取不到最终地址，依赖自动重定向会把
 * 302 端点（如 api.php?get=url / get=pic）的 CDN 直链丢掉；
 * 因此关闭自动跟随（maxRedirects: 0），逐跳处理 Location。
 * 注意：部分环境（RN 的 XHR 适配器、axios fetch 适配器）会无视 maxRedirects
 * 自动跟随，此时只会返回原 URL——调用方应自行兜底。
 */
async function followRedirectsToFinalUrl(
  url: string,
  signal?: AbortSignal,
  timeout = 5000
): Promise<{ finalUrl: string; data: unknown }> {
  // 桥模式（mobile WebView Chromium 栈）：302 解析与搜索/歌词走同一
  // 网络栈和 cookie jar。rangeOnly 只取最终地址和 Content-Type，不下载
  // body（mp3 直链可能几十 MB，读 body 会把桥消息撑爆）。桥故障时
  // 继续走下方平台原生路径兜底。
  if (apiRequestHandler) {
    await ensureApiSession().catch(() => {});
    let retried = false;
    const bridgeAttempt = async (): Promise<{ finalUrl: string; data: unknown }> => {
      const res = await apiRequestHandler!({
        method: 'GET',
        url,
        headers: { Range: 'bytes=0-0' },
        rangeOnly: true,
        timeoutMs: timeout,
      });
      const hdrs = res.headers || {};
      const ct = String(hdrs['content-type'] || hdrs['Content-Type'] || '').toLowerCase();
      const finalUrl = res.finalUrl && /^https?:\/\//.test(res.finalUrl) ? res.finalUrl : url;
      // 最终地址仍是 api.php 且返回 HTML = 会话失效（「非法请求」页）：
      // 重建会话（桥内 cookie jar 会随新 Set-Cookie 更新）后重试一次
      if (finalUrl === url && ct.includes('text/html') && !retried) {
        retried = true;
        invalidateApiSession();
        await ensureApiSession().catch(() => {});
        return bridgeAttempt();
      }
      if (apiTimingLog) {
        console.log(
          `[api耗时] bridge-302 ${String(url).slice(0, 70)}: status=${res.status} ct=${ct.slice(0, 30)} final=${finalUrl.slice(0, 60)}`,
        );
      }
      return { finalUrl, data: ct.includes('text/html') ? INVALID_REQUEST_MARKER : '' };
    };
    try {
      return await bridgeAttempt();
    } catch {
      // 桥不可用：继续走平台原生路径兜底
    }
  }
  // RN：XHR 无视 maxRedirects 自动跟随 302 并下载完整响应体——
  // 播放 URL 的 302 终点是 10MB 级 mp3，等 axios 返回要几十秒；
  // XHR 的 responseURL 在 readyState 2 abort 时不可靠（实测返回中间跳
  // 的 api.php 而非最终 mp3）。
  // 改用 fetch（默认自动跟随 302 链）+ Range: bytes=0-0：
  // mp3 CDN 支持 Range 时回 1 字节（206），拒绝时回 403 小 body——
  // 两者都秒回，response.url 即最终 mp3 直链，不依赖 XHR responseURL。
  if (IS_REACT_NATIVE) {
    return (async () => {
      // 先确保会话：首页 GET 预热原生 cookie jar（jar 空时 api.php 无 cookie
      // 必返回 200「非法请求」而非 302，拿不到 mp3 直链）
      await ensureApiSession().catch(() => {});
      let retried = false;
      const attempt = async (): Promise<{ finalUrl: string; data: unknown }> => {
        try {
          // 用 axios 替代 fetch 做 302 解析：
          // RN fetch 的 credentials:'include' 实测不带原生 jar cookie，
          // 而服务端对部分源（酷狗 get=url）严格校验 PHPSESSID —— 无 cookie
          // 返回「非法请求」页（200 text/html），拿不到 CDN 直链。
          // axios（withCredentials 已配置）走 XHR 自动带 jar cookie；
          // XHR 自动跟随 302（无视 maxRedirects），Range 206 秒回 1 字节，
          // responseURL 即最终 CDN 直链（完整响应下可靠，非 abort 场景）。
          const resolveHeaders: Record<string, string> = { Range: 'bytes=0-0' };
          const referer = refererForUrl(url);
          if (referer) resolveHeaders['Referer'] = referer;
          resolveHeaders['User-Agent'] = BROWSER_UA;
          const resp = await apiClient.get(url, {
            headers: resolveHeaders,
            timeout,
            responseType: 'arraybuffer',
            // 显式声明该请求是 302 解析（响应拦截器不需要特殊处理）
            __resolve302: true,
          } as any);
          const ct = String(resp.headers['content-type'] || '');
          // text/html = 无 cookie 的「非法请求」页：刷新会话后重试一次
          if (ct.includes('text/html') && !retried) {
            retried = true;
            invalidateApiSession();
            await ensureApiSession().catch(() => {});
            return attempt();
          }
          if (apiTimingLog) {
            console.log(
              `[api耗时] xhr-302 ${String(url).slice(0, 70)}: status=${resp.status} ct=${ct.slice(0, 30)}`,
            );
          }
          const responseUrl = (resp.request as any)?.responseURL;
          const finalUrl = responseUrl && /^https?:\/\//.test(responseUrl) ? responseUrl : url;
          return { finalUrl, data: '' };
        } catch {
          return { finalUrl: url, data: '' };
        }
      };
      return attempt();
    })();
  }
  const MAX_REDIRECTS = 3;
  let currentUrl = url;
  let finalUrl = url;
  let lastResponse: { data: unknown } | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const response = await apiClient.get(currentUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400, // 3xx 也接受，交给下面处理
      timeout,
      signal: signal as any,
    });
    finalUrl = currentUrl;
    lastResponse = response;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) break; // 无 Location 的重定向：按当前 URL 兜底
      currentUrl = new URL(String(location), currentUrl).href;
      continue;
    }
    break;
  }
  // 部分适配器（RN XHR、axios fetch 适配器）无视 maxRedirects 自动跟随重定向，
  // 此时拿不到 3xx 响应；若平台暴露了最终地址（responseURL），用它兜底。
  const autoFollowedUrl = (lastResponse as any)?.request?.responseURL;
  if (
    typeof autoFollowedUrl === 'string' &&
    /^https?:\/\//.test(autoFollowedUrl) &&
    autoFollowedUrl !== url
  ) {
    finalUrl = autoFollowedUrl;
  }
  return { finalUrl, data: lastResponse?.data };
}

/**
 * 封面 URL 解析：api.php?get=pic 封面端点需要会话 cookie，
 * 移动端原生 <Image> 无法携带，解析成 CDN 直链后即可直接加载。
 * 非 api.php URL 原样返回；解析失败/会话不可用回退原 URL（渲染端占位图兜底）。
 * 结果带 6 小时 TTL 缓存，缓存 key 用归一化 URL（忽略 t/sign 等签名参数）：
 * 同一首歌每次搜索返回不同签名链接，但内容是同一张封面——归一化后
 * 命中同一缓存，避免每次搜索都重新解析、拿到新时间戳直链导致
 * <Image> 反复重载（"封面时不时刷新"）。
 * 未发生重定向（适配器自动跟随拿不到 Location）时不缓存，避免长期保留故障态。
 */
export async function resolveCoverUrl(coverUrl: string): Promise<string> {
  const fullUrl = normalizeUrl(coverUrl);
  if (!fullUrl || !isSessionProtectedEndpoint(fullUrl)) return fullUrl;
  const cacheKey = resourceUrlKey(fullUrl);
  const cached = coverUrlCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.url;
  try {
    // 封面解析：3s 快速超时（失败有占位图兜底），不让封面占住并发槽位
    const { finalUrl, data } = await runResolve(fullUrl, COVER_RESOLVE_TIMEOUT_MS);
    if (typeof data === 'string' && data.includes(INVALID_REQUEST_MARKER)) {
      return fullUrl; // 会话不可用：不缓存，回退原 URL
    }
    if (finalUrl !== fullUrl) {
      coverUrlCache.set(cacheKey, { url: finalUrl, expires: Date.now() + COVER_URL_CACHE_TTL });
    }
    return finalUrl;
  } catch {
    return fullUrl;
  }
}

/**
 * 封面解析缓存失效：<Image> 加载失败（onError）说明缓存里的 CDN 直链
 * 已过期/失效，清除对应归一化 key 的缓存，让下一次 resolveCoverUrl
 * 重新解析拿到新直链（否则归一化 key 会一直命中失效缓存，封面永远
 * 失败占位）。调用方在 onError 后、兜底刷新前调用。
 */
export function invalidateCoverUrl(coverUrl: string): void {
  const fullUrl = normalizeUrl(coverUrl);
  if (!fullUrl) return;
  coverUrlCache.delete(resourceUrlKey(fullUrl));
}

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

/**
 * 处理歌曲数据，补全所有 URL 字段
 */
function processSong(song: any, sourceType: SourceKey = 'netease'): Song {
  return {
    // id 统一字符串：API 部分源返回数字 id，按 ID 识别/URL-ID 比对都要求字符串
    id: String(song.id || song.songid || ''),
    name: song.name || song.songname || '',
    artist: song.artist || song.authors || '',
    album: song.album || song.albumname || '',
    url: normalizeUrl(song.url),
    cover: normalizeUrl(song.cover || song.pic),
    lrc: normalizeUrl(song.lrc || song.lyric || song.lrcurl),
    duration: song.duration || song.interval || 0,
    sourceType: song.sourceType || sourceType
  };
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

    const apiURL = 'https://api.qishui.com/luna/pc/search/track?' + params.toString();
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


  async fetchSodaSharePage(trackId: string): Promise<{ audioUrl: string; name: string; artist: string; cover: string } | null> {
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
      return {
        audioUrl: decodeURIComponent(audio.url),
        name: audio.trackName || '',
        artist: audio.artistName || '',
        cover: audio.coverURL || '',
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

  async searchSongs(keyword: string, page: number = 1, sourceType: SourceKey = 'netease'): Promise<Song[]> {
    if (sourceType === 'soda') {
      return this.searchSongsSoda(keyword, page);
    }

    const cachedData = cacheManager.getSearchCache(keyword, page, sourceType);
    if (cachedData) {
      return cachedData;
    }

    // 自建 API 已退役：桌面不再配置 API_BASE_URL，直接返回空结果，
    // 避免 auto 回退链每次刷 Invalid URL。
    if (!API_BASE_URL) return [];

    const params = new URLSearchParams();
    params.append('input', keyword);
    params.append('filter', 'name');
    params.append('type', sourceType);
    params.append('page', page.toString());

    // per-request 8s 超时：多源搜索 Promise.all 等最慢源，某源挂起不能拖 30s
    let response;
    try {
      response = await apiClient.post('', params, { timeout: 8000 });
    } catch (e: any) {
      // 识别失败诊断：请求异常（Metro 终端可见；正常命中不打日志避免刷屏）
      console.warn(`[search] 识别失败: 「${keyword}」 ${sourceType} 请求异常 ${e?.message || e}`);
      throw e;
    }
    const songs: Partial<Song>[] = response.data.data || [];
    if (songs.length === 0) {
      console.warn(`[search] 识别失败: 「${keyword}」 ${sourceType} 返回 0 首`);
    }

    const processedSongs = songs.map(song => processSong(song, sourceType));

    cacheManager.setSearchCache(keyword, page, sourceType, processedSongs);
    return processedSongs;
  },

  /**
   * 按源站歌曲 ID 直接识别（filter=id）：链接会过期，但 ID 不会——
   * 播放失败/歌词封面补全时优先按 ID 拿新鲜的 url/lrc/cover（三件套），
   * 完全绕开"按名字搜索 + 匹配"（Live/翻唱/多歌手导致的匹配失败）。
   * 失败返回 null（调用方回退名字搜索）。
   * @param force 为 true 时绕过 6h 搜索缓存（fresh 重试路径必须传：缓存里正是失败的那个过期 url）
   */
  async searchSongById(songId: string, sourceType: SourceKey = 'netease', force = false): Promise<Song | null> {
    if (!songId || sourceType === 'soda') return null;
    const cacheKey = `song_by_id_${sourceType}_${songId}`;
    if (!force) {
      const cached = cacheManager.getSearchCache(cacheKey, 1, sourceType);
      if (cached?.length) return cached[0];
    }

    // 自建 API 已退役：桌面不再配置 API_BASE_URL，ID 识别只能走旧 API；
    // 直接返回 null 让调用方回退到按名字搜索，避免每次刷 Invalid URL。
    if (!API_BASE_URL) return null;

    const params = new URLSearchParams();
    params.append('input', songId);
    params.append('filter', 'id');
    params.append('type', sourceType);
    params.append('page', '1');

    try {
      const response = await apiClient.post('', params, { timeout: 8000 });
      const songs: Partial<Song>[] = response.data.data || [];
      const processed = songs.map(song => processSong(song, sourceType));
      // 校验返回的歌确实是对应 ID：filter=id 不严格时可能回退相似歌曲，
      // 不校验会把别的歌的 url 挂到目标歌上（错误音频）
      const found = processed.find(s => s.id && (s.id === songId || stripSourceIdPrefix(s.id) === songId));
      if (!found) {
        console.warn(`[search] 按ID识别失败: ${sourceType} ${songId} 返回 ${processed.length} 首但无匹配 ID`);
        return null;
      }
      cacheManager.setSearchCache(cacheKey, 1, sourceType, processed);
      return found;
    } catch (e: any) {
      console.warn(`[search] 按ID识别失败: ${sourceType} ${songId} 请求异常 ${e?.message || e}`);
      return null;
    }
  },

  async getAudioUrl(audioUrl: string, signal?: AbortSignal): Promise<string> {
    const fullUrl = normalizeUrl(audioUrl);
    if (!fullUrl) return '';

    // 尝试从URL缓存获取
    const cachedData = cacheManager.getAudioUrlCache(fullUrl);
    if (cachedData) {
      return cachedData;
    }

      // 带重试的 URL 解析（最多 3 次尝试，指数退避）
      const MAX_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        try {
          // 播放 URL 解析：优先于封面（插队）+ 12s 超时。
          // 手机网络波动大（LTE 下 api.php 响应 1-15s），5s 必超时回退
          // 原 URL（播放器无 cookie 加载 api.php → Source error），
          // 12s 覆盖慢网络，宁可多等也要拿到真直链
          const { finalUrl, data } = await runResolve(fullUrl, AUDIO_RESOLVE_TIMEOUT_MS, true);

        if (finalUrl.startsWith('data:text/html')) {
          const errorMsg = typeof data === 'string' ? data : '获取音频失败';
          throw new Error(errorMsg);
        }

        // 死链不缓存：受保护端点（api.php?get=url）解析回原样 = 签名过期/
        // 会话失效，服务端返回的是错误页而非 302。缓存死链会让 1h 内
        // 重放直接拿到错误地址（连 fresh 重试的机会都没有）。
        if (!(finalUrl === fullUrl && isSessionProtectedEndpoint(fullUrl))) {
          cacheManager.setAudioUrlCache(fullUrl, finalUrl);
        }

        return finalUrl;
      } catch (error: any) {
        if (error.name === 'AbortError' || signal?.aborted) {
          throw error;
        }

        const isLastAttempt = attempt === MAX_RETRIES;
        if (isLastAttempt) {
          console.error('getAudioUrl 失败（已重试', MAX_RETRIES, '次）:', error);
          return fullUrl;
        }

        const delay = 500 * Math.pow(2, attempt);
        console.warn(`getAudioUrl 第 ${attempt + 1} 次失败，${delay}ms 后重试:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return fullUrl;
  },

  resolveCoverUrl,

  invalidateCoverUrl,

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
   * 按网易云 songId 获取歌词文本（LRC）。
   * 兜底场景：今日推荐/歌单/歌手页的歌曲 lrc 字段为空
   * （源接口不返回歌词链接），播放时用它补上。
   * 无歌词（纯音乐等）返回空串。
   */
  async getLyricsBySongId(songId: string): Promise<string> {
    if (!songId) return '';
    const cacheKey = `lyric_id_${songId}`;
    const cached = cacheManager.getLyricsCache(cacheKey);
    if (cached !== null) return cached;

    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(
        `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=-1`
      );
      const lyrics = (response.data?.lrc?.lyric as string) || '';
      cacheManager.setLyricsCache(cacheKey, lyrics);
      return lyrics;
    } catch {
      return '';
    }
  },

  /**
   * 批量搜索
   * @param concurrency 并发上限,0 表示不限制(默认);限制可避免弱 API 排队/被打爆
   */
  async batchSearch(keywords: string[], sourceType: SourceKey = 'netease', concurrency: number = 3): Promise<Record<string, Song[]>> {
    // 尝试从缓存获取
    const cachedData = cacheManager.getBatchSearchCache(keywords, sourceType);
    if (cachedData) {
      return cachedData;
    }

    const results: Song[][] = new Array(keywords.length);
    const workerCount = concurrency > 0 ? Math.min(concurrency, keywords.length) : keywords.length;
    let nextIndex = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= keywords.length) break;
        try {
          results[i] = await this.searchSongs(keywords[i], 1, sourceType);
        } catch (error) {
          console.error(`搜索关键词 "${keywords[i]}" 失败:`, error);
          results[i] = [];
        }
      }
    });
    await Promise.all(workers);

    const batchResult: Record<string, Song[]> = {};
    keywords.forEach((keyword, index) => {
      batchResult[keyword] = results[index] || [];
    });

    // 缓存结果
    cacheManager.setBatchSearchCache(keywords, sourceType, batchResult);
    return batchResult;
  },

  async searchNeteaseArtists(keyword: string, limit: number = 30): Promise<any[]> {
    const cacheKey = `search_artists_${keyword}_${limit}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && Array.isArray(cached)) {
      return cached as unknown as any[];
    }

    const mapArtists = (rawArtists: any[]) => rawArtists.map((a: any) => ({
      id: String(a.id),
      name: a.name || '',
      picUrl: (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:'),
      alias: a.alias || [],
      trans: a.trans || undefined,
      albumSize: a.albumSize || 0,
      musicSize: a.musicSize || 0,
      sourceType: 'netease'
    }));

    // 注:cloudsearch weapi 已被网易云风控(code=50000005,无 cookie 必现),
    // 直接走旧接口(已做 https 头像修复);后续若接入 cookie 机制可恢复 weapi 优先
    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=100&limit=${limit}`);
      const data = response.data;
      const rawArtists: any[] = data?.result?.artists || [];

      const artists = mapArtists(rawArtists);

      cacheManager.setSearchCache(cacheKey, 1, 'netease', artists as any);
      return artists;
    } catch (error) {
      console.error('搜索歌手失败:', error);
      return [];
    }
  },

  async getNeteaseArtists(cat: number = 1001, offset: number = 0, limit: number = 100, initial: number = -1): Promise<{ artists: any[]; total: number; more: boolean }> {
    const mapped = NETEASE_CAT_MAP[cat];
    if (mapped || cat === 0) {
      // weapi 直连(带头像、结构化、可分页),失败时按原路径兜底
      const res = await this.fetchNeteaseArtistsByWeapi(mapped?.type ?? 0, mapped?.area ?? -1, offset, limit, initial);
      if (res.ok) return res;
      if (cat === 0) return this.fetchNeteaseArtistsByApi(offset, limit, initial);
    }
    return this.fetchNeteaseArtistsByHtml(cat);
  },

  async fetchNeteaseArtistsByWeapi(type: number, area: number, offset: number, limit: number, initial: number): Promise<{ artists: any[]; total: number; more: boolean; ok: boolean }> {
    const cacheKey = `artists_weapi_${type}_${area}_${offset}_${limit}_${initial}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).artists) {
      return cached as unknown as { artists: any[]; total: number; more: boolean; ok: boolean };
    }

    try {
      const data = await weapiRequest<any>('/v1/artist/list', { type, area, initial, offset, limit, total: true });
      if (data.code !== 200 || !data.artists) {
        throw new Error(`获取歌手列表失败 (type=${type}, area=${area})`);
      }
      const artists = data.artists.map((a: any) => ({
        id: String(a.id),
        name: a.name || '',
        picUrl: (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:'),
        alias: a.alias || [],
        trans: a.trans || undefined,
        albumSize: a.albumSize || 0,
        musicSize: a.musicSize || 0,
        sourceType: 'netease'
      }));

      for (const a of artists) {
        if (a.picUrl && !artistPicCache.has(a.name)) {
          artistPicCache.set(a.name, a.picUrl);
        }
      }

      const result = { artists, total: artists.length, more: data.more !== false, ok: true };
      cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
      return result;
    } catch (error) {
      console.error('获取歌手列表失败(weapi):', error);
      return { artists: [], total: 0, more: false, ok: false };
    }
  },

  async fetchNeteaseArtistsByApi(offset: number, limit: number, initial: number): Promise<{ artists: any[]; total: number; more: boolean }> {
    const cacheKey = `artists_api_${offset}_${limit}_${initial}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).artists) {
      return cached as unknown as { artists: any[]; total: number; more: boolean };
    }

    try {
      const neteaseClient = createNeteaseClient();
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
        initial: String(initial),
      });
      const response = await neteaseClient.get(`https://music.163.com/api/v1/artist/list?${params.toString()}`);
      const data = response.data;
      const rawArtists: any[] = data?.artists || [];
      const more: boolean = data?.more || false;

      const artists = rawArtists.map((a: any) => ({
        id: String(a.id),
        name: a.name || '',
        picUrl: a.picUrl || a.img1v1Url || '',
        alias: a.alias || [],
        trans: a.trans || undefined,
        albumSize: a.albumSize || 0,
        musicSize: a.musicSize || 0,
        sourceType: 'netease'
      }));

      // 缓存歌手头像地址，供分类 tab 爬取时补图
      for (const a of artists) {
        if (a.picUrl && !artistPicCache.has(a.name)) {
          artistPicCache.set(a.name, a.picUrl);
        }
      }

      const result = { artists, total: artists.length, more };
      cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
      return result;
    } catch (error) {
      console.error('获取歌手列表失败:', error);
      return { artists: [], total: 0, more: false };
    }
  },

  async fetchNeteaseArtistsByHtml(catId: number): Promise<{ artists: any[]; total: number; more: boolean }> {
    const cacheKey = `artists_html_${catId}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).artists) {
      return cached as unknown as { artists: any[]; total: number; more: boolean };
    }

    try {
      const neteaseClient = createNeteaseClient();
      const response = await neteaseClient.get(`https://music.163.com/discover/artist/cat?id=${catId}`);
      const html = response.data;

      const artistBoxMatch = html.match(/id="m-artist-box">(.*?)<\/ul>/s);
      if (!artistBoxMatch) {
        console.error('[musicApi] fetchNeteaseArtistsByHtml 未找到歌手列表数据');
        return { artists: [], total: 0, more: false };
      }

      const box = artistBoxMatch[1];
      const itemRegex = /<li[^>]*>(.*?)<\/li>/gs;
      const artists: any[] = [];
      let itemMatch;

      while ((itemMatch = itemRegex.exec(box)) !== null) {
        const item = itemMatch[1];
        const nameMatch = item.match(/<a[^>]*href="\s*\/artist\?id=(\d+)"[^>]*class="nm[^"]*"[^>]*>([^<]+)<\/a>/);
        if (!nameMatch) continue;

        const imgMatch = item.match(/<img src="([^"]+)"/);
        const name = nameMatch[2].trim();
        const picUrl = imgMatch?.[1] || artistPicCache.get(name) || '';

        artists.push({
          id: nameMatch[1],
          name,
          picUrl,
          alias: [],
          trans: undefined,
          albumSize: 0,
          musicSize: 0,
          sourceType: 'netease'
        });
      }

      // 对 HTML 解析后仍缺图的歌手，限制并发补图 (冷门歌手兜底)
      const CONCURRENCY = 6;
      const artistsNeedingPic = artists.filter(a => !a.picUrl);
      for (let i = 0; i < artistsNeedingPic.length; i += CONCURRENCY) {
        const batch = artistsNeedingPic.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (a) => {
          try {
            const detailRes = await neteaseClient.get(`https://music.163.com/api/artist?id=${a.id}`);
            const detail = detailRes.data?.artist;
            a.picUrl = detail?.picUrl || detail?.img1v1Url || '';
            if (a.picUrl) artistPicCache.set(a.name, a.picUrl);
          } catch {}
        }));
      }

      const result = { artists, total: artists.length, more: false };
      cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
      return result;
    } catch (error) {
      console.error('获取歌手列表失败:', error);
      return { artists: [], total: 0, more: false };
    }
  },

  async getNeteaseArtistSongs(artistId: string, offset: number = 0, limit: number = 50, order: string = 'hot'): Promise<{ songs: Song[]; total: number }> {
    const cacheKey = `artist_songs_${artistId}_${offset}_${limit}_${order}`;
    const cached = cacheManager.getSearchCache(cacheKey, 1, 'netease');
    if (cached && (cached as any).songs) {
      return cached as unknown as { songs: Song[]; total: number };
    }

    let songs: Song[] = [];
    let total = 0;
    try {
      const data = await weapiRequest<any>('/v1/artist/songs', { id: Number(artistId), private_cloud: 'true', work_type: 1, order, offset, limit });
      if (data.code !== 200) {
        throw new Error(`获取歌手歌曲失败 (artistId=${artistId})`);
      }
      songs = (data.songs || []).map((song: any) => processNeteaseTrack(song));
      total = data.total || 0;
    } catch (error) {
      console.error(`获取歌手歌曲失败(weapi),回退旧接口 (artistId=${artistId}):`, error);
      try {
        const neteaseClient = createNeteaseClient();
        const response = await neteaseClient.get(`https://music.163.com/api/v1/artist/songs?id=${artistId}&offset=${offset}&limit=${limit}&order=${order}`);
        const data = response.data;
        songs = (data.songs || []).map((song: any) => processNeteaseTrack(song));
        total = data.total || 0;
      } catch (error2) {
        console.error('获取歌手歌曲失败(旧接口):', error2);
        return { songs: [], total: 0 };
      }
    }

    const result = { songs, total };
    cacheManager.setSearchCache(cacheKey, 1, 'netease', result as any);
    return result;
  },

  /**
   * 网易云音乐排行榜通用方法
   * @param playlistId 歌单 ID(热歌榜 3778678,新歌榜 3779629)
   * @param cacheKey 缓存键
   */
  async getNeteaseToplist(playlistId: number, cacheKey: string): Promise<HotlistSong[]> {
    const cachedData = cacheManager.getHotlistCache(cacheKey);
    if (cachedData && cachedData.length > 0) {
      return cachedData;
    }

    const tracks: any[] = [];
    try {
      // weapi:一次请求即带全量 tracks
      const data = await weapiRequest<any>('/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
      if (data.code !== 200 || !data.playlist?.tracks) {
        throw new Error(`获取网易排行榜数据失败 (playlistId=${playlistId})`);
      }
      tracks.push(...data.playlist.tracks);
    } catch (error) {
      console.error(`获取网易排行榜失败 (cacheKey=${cacheKey}),回退旧接口:`, error);
      try {
        const p = await fetchNeteasePlaylistLegacy(playlistId);
        if (p?.tracks) tracks.push(...p.tracks);
      } catch (error2) {
        console.error(`获取网易排行榜失败 (cacheKey=${cacheKey},旧接口):`, error2);
      }
    }

    const hotlistSongs: HotlistSong[] = tracks.map((song: any, index: number) => {
      const artists = (song.ar || song.artists || []).map((artist: any) => artist.name).join('/');
      const cover = (song.al?.picUrl || song.album?.picUrl || '');

      return {
        id: song.id.toString(),
        name: song.name,
        artists: artists,
        rank: index + 1,
        cover: cover,
        album: song.al?.name || song.album?.name || ''
      };
    });

    if (hotlistSongs.length > 0) {
      cacheManager.setHotlistCache(cacheKey, hotlistSongs);
    }
    return hotlistSongs;
  },

  async getNeteaseHotlist(): Promise<HotlistSong[]> {
    return this.getNeteaseToplist(3778678, 'netease');
  },

  async getNeteaseNewSongList(): Promise<HotlistSong[]> {
    return this.getNeteaseToplist(3779629, 'netease_new');
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

  async getNeteasePlaylists(
    cat: string = '全部',
    order: string = 'hot',
    offset: number = 0,
    limit: number = 35
  ): Promise<{ playlists: DiscoverPlaylist[]; total: number; more: boolean }> {
    const cacheKey = `playlistList_${cat}_${order}_${offset}_${limit}`;
    const cached = cacheManager.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const neteaseClient = axios.create({
        headers: {
          'accept': 'application/json, text/javascript, */*; q=0.01',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://music.163.com/'
        },
        timeout: 30000,
    proxy: false,
      });

      const response = await neteaseClient.get(
        `https://music.163.com/api/playlist/list?cat=${encodeURIComponent(cat)}&order=${order}&offset=${offset}&limit=${limit}`
      );

      const data = response.data;
      const playlists: DiscoverPlaylist[] = (data.playlists || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        coverImgUrl: p.coverImgUrl || '',
        playCount: p.playCount || 0,
        trackCount: p.trackCount || 0,
        creator: { nickname: p.creator?.nickname || '' },
        tags: (p.tags || []).map((t: any) => typeof t === "string" ? t : t.name || ""),
        description: p.description || ''
      }));

      const result = {
        playlists,
        total: data.total || 0,
        more: data.more || false
      };

      cacheManager.set(cacheKey, result, 5 * 60 * 1000);
      return result;
    } catch (error) {
      console.error('[MusicApi] getNeteasePlaylists 失败:', error);
      return { playlists: [], total: 0, more: false };
    }
  },

  async getNeteasePlaylistDetail(id: number): Promise<DiscoverPlaylist | null> {
    const cacheKey = `playlistDetail_${id}`;
    const cached = cacheManager.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    let playlistData: any = null;
    try {
      const data = await weapiRequest<any>('/v6/playlist/detail', { id, n: 100000, s: 8 });
      if (data.code !== 200 || !data.playlist) {
        throw new Error(`获取网易云歌单详情失败 (id=${id})`);
      }
      playlistData = data.playlist;
    } catch (error) {
      console.error(`[MusicApi] getNeteasePlaylistDetail weapi 失败,回退旧接口:`, error);
      try {
        playlistData = await fetchNeteasePlaylistLegacy(id);
      } catch (error2) {
        console.error('[MusicApi] getNeteasePlaylistDetail 失败(旧接口):', error2);
      }
    }

    if (!playlistData) return null;

    const playlist: DiscoverPlaylist = {
      id: playlistData.id,
      name: playlistData.name,
      coverImgUrl: playlistData.coverImgUrl || '',
      playCount: playlistData.playCount || 0,
      trackCount: playlistData.trackCount || 0,
      creator: { nickname: playlistData.creator?.nickname || '' },
      tags: (playlistData.tags || []).map((t: any) => typeof t === "string" ? t : t.name || ""),
      description: playlistData.description || ''
    };

    cacheManager.set(cacheKey, playlist, 5 * 60 * 1000);
    return playlist;
  },

  /**
   * 获取网易云歌单全量 trackIds(weapi 直连,精确 id,10 分钟缓存)
   * 分页与全量获取共用,避免重复请求歌单元信息
   */
  async getNeteasePlaylistTrackIds(playlistId: number): Promise<number[]> {
    const cacheKey = `netease_playlist_trackids_${playlistId}`;
    const cached = cacheManager.get<number[]>(cacheKey);
    if (cached) return cached;

    let trackIds: number[] = [];
    try {
      const detail = await weapiRequest<{ code: number; playlist?: any }>('/v6/playlist/detail', { id: playlistId, n: 100000, s: 8 });
      if (detail.code !== 200 || !detail.playlist) {
        throw new Error(`获取网易云歌单失败 (id=${playlistId})`);
      }
      trackIds = (detail.playlist.trackIds || []).map((t: any) => t.id);
    } catch (error) {
      console.error(`[MusicApi] getNeteasePlaylistTrackIds weapi 失败,回退旧接口 (id=${playlistId}):`, error);
      try {
        const p = await fetchNeteasePlaylistLegacy(playlistId);
        trackIds = (p?.tracks || []).map((t: any) => t.id);
      } catch (error2) {
        console.error(`[MusicApi] getNeteasePlaylistTrackIds 失败(旧接口) (id=${playlistId}):`, error2);
      }
    }

    if (trackIds.length > 0) cacheManager.set(cacheKey, trackIds, 10 * 60 * 1000);
    return trackIds;
  },

  /**
   * weapi 批量取歌曲播放地址(id → url),免费歌曲全覆盖,VIP 歌返回空
   */
  async fetchNeteaseSongUrlMap(ids: number[]): Promise<Map<number, string>> {
    const urlMap = new Map<number, string>();
    if (ids.length === 0) return urlMap;
    try {
      const urlData = await weapiRequest<{ code: number; data?: { id: number; url?: string }[] }>(
        '/song/enhance/player/url/v1',
        { ids: '[' + ids.join(',') + ']', level: 'standard', encodeType: 'mp3' }
      );
      if (urlData.code === 200 && Array.isArray(urlData.data)) {
        for (const d of urlData.data) {
          if (d.url) urlMap.set(d.id, d.url.replace(/^http:/, 'https:'));
        }
      }
    } catch (error) {
      console.error('[MusicApi] fetchNeteaseSongUrlMap 失败:', error);
    }
    return urlMap;
  },

  /**
   * 搜索兜底:剩余无 url 的歌曲(通常为 VIP)用「歌名+歌手」通过自有搜索 API 拿直链。
   * - healthCheck 结果缓存 60 秒,避免每页重复探测
   * - 搜索无结果的歌曲记入黑名单(会话级),后续页不再重复搜索
   */
  /**
   * 逐首搜索兜底（补无版权/无直链歌曲的 URL）。
   * @param albumName 专辑名预搜：一次请求命中专辑内多首歌（服务端 name 搜索会
   *   匹配专辑字段），按 name|artist 精确过滤填 URL——把 N 首逐首搜索降为
   *   1 次专辑搜索 + 少量剩余。服务端对 AJAX 请求限速（连发尖峰 1-3s+），
   *   减少请求数是最有效的提速手段。
   */
  async resolveNeteaseSongUrlsBySearch(songs: Song[], albumName?: string): Promise<void> {
    // 先清掉过期的黑名单项（瞬时故障不能永久拉黑）
    const now = Date.now();
    // 专辑名预搜：一次请求批量命中（精确匹配 name|artist，防翻唱误挂）
    if (albumName && songs.some((s) => !s.url)) {
      try {
        const albumHits = await this.searchSongs(albumName, 1, 'netease');
        const byKey = new Map(albumHits.map((s) => [`${s.name}|${s.artist}`, s]));
        for (const song of songs) {
          if (song.url) continue;
          const hit = byKey.get(`${song.name}|${song.artist}`);
          if (hit?.url) song.url = hit.url;
        }
      } catch {
        // 专辑名预搜失败不影响逐首兜底
      }
    }
    for (const [id, at] of searchFailedSongIds) {
      if (now - at >= SEARCH_FAILED_TTL) searchFailedSongIds.delete(id);
    }
    const missingUrlSongs = songs.filter(s => !s.url && !searchFailedSongIds.has(s.id));
    if (missingUrlSongs.length === 0) return;

    let apiOk: boolean;
    if (now - healthCheckCache.at < HEALTH_CHECK_TTL) {
      apiOk = healthCheckCache.ok;
    } else {
      apiOk = await this.healthCheck();
      healthCheckCache = { at: now, ok: apiOk };
    }
    // healthCheck 失败（3s 超时，API 限流/慢时常见）不阻断搜索兜底：
    // url 缺失会导致探测全标「无效」、播放无链接——比多打几个搜索请求
    // 更糟。搜索兜底自身有 12s 超时 + 10 并发闸门兜底。
    if (!apiOk) {
      console.warn('[MusicApi] healthCheck 失败，仍尝试搜索兜底补齐 URL');
    }

    try {
      const keywords = missingUrlSongs.map(s => `${s.name} ${s.artist}`.trim());
      // 限 10 并发:单页搜索兜底更快,弱 API 排队仍可控
      const searchResults = await this.batchSearch(keywords, 'netease', 10);
      for (let i = 0; i < missingUrlSongs.length; i++) {
        const song = missingUrlSongs[i];
        // 精确匹配 name+artist：无版权歌的搜索结果第一条通常是翻唱/Live 版，
        // 直接取会填上错误的 URL（播放/探测都会被误导）
        const hit = findExactMatch(
          { name: song.name, artist: song.artist },
          searchResults[keywords[i]] || []
        ) as Song | undefined;
        if (hit?.url) {
          song.url = hit.url;
        } else {
          searchFailedSongIds.set(song.id, Date.now());
        }
      }
    } catch (error) {
      console.error('[MusicApi] resolveNeteaseSongUrlsBySearch 搜索兜底失败:', error);
    }
  },

  /**
   * 批量补齐歌曲可播放 URL(全量场景用):weapi 批量直连 + 搜索兜底
   * @param skipSearchFallback 为 true 时跳过逐首搜索兜底(慢),适合移动端详情页:
   *   无 URL 歌曲播放时再由 resolvePlayableUrl 单首解析,避免进入详情页长时间等待
   */
  async resolveNeteaseSongUrls(songs: Song[], skipSearchFallback: boolean = false): Promise<void> {
    const ids = songs.map(s => Number(s.id)).filter(id => Number.isFinite(id) && id > 0);
    const urlMap = await this.fetchNeteaseSongUrlMap(ids);
    for (const song of songs) {
      const u = urlMap.get(Number(song.id));
      if (u) song.url = u;
    }
    if (!skipSearchFallback) {
      await this.resolveNeteaseSongUrlsBySearch(songs);
    }
  },

  /**
   * 分页获取网易云歌单歌曲(详情页滚动加载用,避免一次性全量拉取)
   * @param playlistId 歌单 ID
   * @param offset 起始偏移
   * @param limit 每页数量
   * @returns 本页歌曲与歌单总曲数
   */
  async getNeteasePlaylistSongsPage(playlistId: number, offset: number = 0, limit: number = 50, skipSearchFallback: boolean = false): Promise<{ songs: Song[]; total: number }> {
    const cacheKey = `netease_playlist_page_${playlistId}_${offset}_${limit}`;
    const cached = cacheManager.get<{ songs: Song[]; total: number }>(cacheKey);
    if (cached) return cached;

    const trackIds = await this.getNeteasePlaylistTrackIds(playlistId);
    let songs: Song[] = [];
    const pageIds = trackIds.slice(offset, offset + limit);

    if (pageIds.length > 0) {
      try {
        // 详情与播放地址互不依赖,并行请求省一个 RTT
        const [detailRes, urlMap] = await Promise.all([
          weapiRequest<{ songs?: any[] }>('/v3/song/detail', { c: JSON.stringify(pageIds.map(id => ({ id }))) }),
          this.fetchNeteaseSongUrlMap(pageIds),
        ]);
        songs = (detailRes.songs || []).map((t: any) => processNeteaseTrack(t));
        for (const song of songs) {
          const u = urlMap.get(Number(song.id));
          if (u) song.url = u;
        }
      } catch (error) {
        console.error(`[MusicApi] getNeteasePlaylistSongsPage weapi 失败,回退旧接口 (id=${playlistId}):`, error);
        try {
          const p = await fetchNeteasePlaylistLegacy(playlistId);
          songs = (p?.tracks || []).slice(offset, offset + limit).map((t: any) => processNeteaseTrack(t));
        } catch (error2) {
          console.error(`[MusicApi] getNeteasePlaylistSongsPage 失败(旧接口) (id=${playlistId}):`, error2);
        }
      }
      if (!skipSearchFallback) {
        await this.resolveNeteaseSongUrlsBySearch(songs);
      }
    }

    const result = { songs, total: trackIds.length };
    // 空页不缓存(offset 越界 / 瞬时故障),避免 10 分钟内无法自愈
    if (songs.length > 0) cacheManager.set(cacheKey, result, 10 * 60 * 1000);
    return result;
  },

  /**
   * 获取网易云歌单全部歌曲(weapi 直连,精确 trackId 批量取详情)
   * 供导入/保存等需要一次性全量的场景使用;详情页请用 getNeteasePlaylistSongsPage 分页
   * @param playlistId 歌单 ID
   * @param limit 限制返回数量,0 表示全部
   */
  async getNeteasePlaylistSongs(playlistId: number, limit: number = 0): Promise<Song[]> {
    const cacheKey = `netease_playlist_songs_${playlistId}_${limit}`;
    const cached = cacheManager.get<Song[]>(cacheKey);
    if (cached) return cached;

    const trackIds = await this.getNeteasePlaylistTrackIds(playlistId);
    let songs: Song[] = [];

    // 每批最多 1000 个 id,并行取详情
    try {
      const batches: number[][] = [];
      for (let i = 0; i < trackIds.length; i += 1000) batches.push(trackIds.slice(i, i + 1000));
      const results = await Promise.all(
        batches.map(batch => weapiRequest<{ songs?: any[] }>('/v3/song/detail', { c: JSON.stringify(batch.map(id => ({ id }))) }))
      );
      for (const r of results) {
        for (const t of r.songs || []) songs.push(processNeteaseTrack(t));
      }
    } catch (error) {
      console.error(`[MusicApi] getNeteasePlaylistSongs weapi 失败,回退旧接口 (id=${playlistId}):`, error);
      try {
        const p = await fetchNeteasePlaylistLegacy(playlistId);
        songs = (p?.tracks || []).map((t: any) => processNeteaseTrack(t));
      } catch (error2) {
        console.error(`[MusicApi] getNeteasePlaylistSongs 失败(旧接口) (id=${playlistId}):`, error2);
      }
    }

    await this.resolveNeteaseSongUrls(songs);

    const result = limit > 0 ? songs.slice(0, limit) : songs;
    // 空结果不缓存,避免瞬时故障导致 10 分钟内无法自愈
    if (result.length > 0) {
      cacheManager.set(cacheKey, result, 10 * 60 * 1000);
    }
    return result;
  },

  async getNewAlbums(area: string = 'ALL', offset: number = 0, limit: number = 30): Promise<Album[]> {
    // key 必须含 offset/limit：分页参数不同返回不同数据，固定 key 会串页
    const cacheKey = `album_new_${area}_${offset}_${limit}`;
    const cached = cacheManager.get<Album[]>(cacheKey);
    if (cached) return cached;

    try {
      // weapi 直连:area 分类真实生效(ZH 华语 / EA 欧美 / KR 韩国 / JP 日本),失败回退旧接口
      const data = await weapiRequest<any>('/album/new', { area, offset, limit, total: true });
      if (data.code !== 200 || !data.albums) {
        throw new Error(`获取新碟失败 (area=${area})`);
      }
      const albums: Album[] = (data.albums as any[]).map(normalizeNeteaseAlbum);
      cacheManager.set(cacheKey, albums, ALBUMS_CACHE_TTL);
      return albums;
    } catch (error) {
      console.error(`[MusicApi] getNewAlbums weapi 失败,回退旧接口 (area=${area}):`, error);
      try {
        const neteaseClient = createNeteaseClient();
        const response = await neteaseClient.get(
          `https://music.163.com/api/album/new?area=${area}&offset=${offset}&limit=${limit}`
        );
        const data = response.data;
        if (!data?.albums) return [];

        const albums: Album[] = (data.albums as any[]).map(normalizeNeteaseAlbum);
        cacheManager.set(cacheKey, albums, ALBUMS_CACHE_TTL);
        return albums;
      } catch (error2) {
        console.error('[MusicApi] getNewAlbums 失败(旧接口):', error2);
        return [];
      }
    }
  },

  /**
   * 获取网易云专辑详情+歌曲列表(weapi 直连,单请求)
   * 专辑歌曲一般 ≤100 首;返回前补齐播放 URL(批量直链 + 搜索兜底),点开即播
   */
  async getAlbumDetail(albumId: string, skipSearchFallback: boolean = false): Promise<{ album: Album; songs: Song[] } | null> {
    const cacheKey = `album_detail_${albumId}`;
    const cached = cacheManager.get<{ album: Album; songs: Song[] }>(cacheKey);
    if (cached) return cached;

    let album: Album | null = null;
    let songs: Song[] = [];
    try {
      const data = await weapiRequest<any>(`/v1/album/${albumId}`, {});
      if (data.code !== 200 || !data.album) {
        throw new Error(`获取专辑详情失败 (albumId=${albumId})`);
      }
      album = normalizeNeteaseAlbum(data.album);
      // 专辑歌曲字段与歌单同构(ar/al/dt),复用同一映射
      songs = (data.songs || []).map((song: any) => processNeteaseTrack(song));
    } catch (error) {
      console.error(`[MusicApi] getAlbumDetail weapi 失败 (albumId=${albumId}):`, error);
      return null;
    }
    if (!album) return null;

    await this.resolveNeteaseSongUrls(songs, skipSearchFallback);

    const result = { album, songs };
    // 空结果不缓存,避免瞬时故障 10 分钟内无法自愈
    if (songs.length > 0) cacheManager.set(cacheKey, result, 10 * 60 * 1000);
    return result;
  },

  /**
   * 分页获取歌手专辑列表(weapi 直连)
   * @param artistId 歌手 ID
   * @param offset 起始偏移
   * @param limit 每页数量
   */
  async getArtistAlbums(artistId: string, offset: number = 0, limit: number = 30): Promise<{ albums: Album[]; total: number; more: boolean }> {
    const cacheKey = `artist_albums_${artistId}_${offset}_${limit}`;
    const cached = cacheManager.get<{ albums: Album[]; total: number; more: boolean }>(cacheKey);
    if (cached) return cached;

    try {
      const data = await weapiRequest<any>(`/artist/albums/${artistId}`, { offset, limit, total: true });
      if (data.code !== 200) {
        throw new Error(`获取歌手专辑失败 (artistId=${artistId})`);
      }
      const rawAlbums: any[] = data.hotAlbums || data.albums || [];
      const albums = rawAlbums.map(normalizeNeteaseAlbum);
      const result = {
        albums,
        total: typeof data.total === 'number' ? data.total : albums.length + offset,
        more: data.more !== false,
      };
      cacheManager.set(cacheKey, result, 10 * 60 * 1000);
      return result;
    } catch (error) {
      console.error(`[MusicApi] getArtistAlbums 失败 (artistId=${artistId}):`, error);
      return { albums: [], total: 0, more: false };
    }
  },

  async getRecommendedPlaylists(limit: number = 30): Promise<DiscoverPlaylist[]> {
    // key 必须含 limit：接口按 limit 返回不同数量的歌单（同 getRecommendedSongs 的修复）
    const cacheKey = `personalized_playlist_${limit}`;
    const cached = cacheManager.get<DiscoverPlaylist[]>(cacheKey);
    if (cached) return cached;

    const mapResult = (result: any[]): DiscoverPlaylist[] => (result || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      coverImgUrl: (p.picUrl || p.coverImgUrl || '').replace(/^http:/, 'https:'),
      playCount: p.playCount || 0,
      trackCount: p.trackCount || 0,
      creator: p.creator ? { nickname: p.creator.nickname || '' } : { nickname: '' },
      tags: [],
      description: p.copywriter || p.description || '',
    }));

    // weapi 直连优先,失败回退旧接口
    try {
      const data = await weapiRequest<any>('/personalized/playlist', { limit });
      if (data?.code === 200 && Array.isArray(data.result)) {
        const playlists = mapResult(data.result);
        cacheManager.set(cacheKey, playlists, RECOMMENDED_CACHE_TTL);
        return playlists;
      }
      throw new Error(`weapi 返回异常 (code=${data?.code})`);
    } catch (error) {
      console.error('[MusicApi] getRecommendedPlaylists weapi 失败,回退旧接口:', error);
    }

    const neteaseClient = createNeteaseClient();
    const response = await neteaseClient.get(
      `https://music.163.com/api/personalized/playlist?limit=${limit}`
    );
    const data = response.data;
    if (!data?.result) return [];

    const playlists = mapResult(data.result);

    cacheManager.set(cacheKey, playlists, RECOMMENDED_CACHE_TTL);
    return playlists;
  },

  async getRecommendedSongs(limit: number = 30): Promise<Song[]> {
    // cacheKey 必须包含 limit：接口按 limit 返回不同数量的歌，
    // 固定 key 会导致拉 15 的缓存污染拉 100 的调用
    const cacheKey = `personalized_newsong_${limit}`;
    const cached = cacheManager.get<Song[]>(cacheKey);
    if (cached) return cached;

    const neteaseClient = createNeteaseClient();
    const response = await neteaseClient.get(
      `https://music.163.com/api/personalized/newsong?limit=${limit}`
    );
    const data = response.data;
    if (!data?.result) return [];

    const songs: Song[] = (data.result as any[]).map((s: any) => ({
      id: String(s.id),
      name: s.name || '',
      artist: (s.artists || []).map((a: any) => a.name).join(' / ') || s.song?.artists?.[0]?.name || '',
      album: s.album?.name || s.song?.album?.name || '',
      url: '',
      cover: s.album?.picUrl || s.picUrl || s.song?.album?.picUrl || '',
      lrc: '',
      duration: s.duration ? Math.floor(s.duration / 1000) : s.song?.duration ? Math.floor(s.song.duration / 1000) : 0,
      sourceType: 'netease' as const,
    }));

    cacheManager.set(cacheKey, songs, RECOMMENDED_CACHE_TTL);
    return songs;
  },


  groupIntoSongGroups(allSongs: Song[]): SongGroup[] {
    return groupIntoSongGroupsUtil(allSongs);
  },

  async getPlaylistSongsFromThirdParty(playlistUrl: string, sourceType: SourceKey = 'netease'): Promise<Song[]> {
    try {
      // Note: unmeta.cn auto-detects the music source from the URL
      // sourceType is used for local search (batchSearch) after getting song names
      const response = await axios.post(
        'https://sss.unmeta.cn/songlist?detailed=false&format=song-singer&order=normal',
        `url=${encodeURIComponent(playlistUrl)}`,
        {
          headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'content-type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://music.unmeta.cn/',
            'Origin': 'https://music.unmeta.cn'
          },
          timeout: 30000
        }
      );

      const data = response.data;
      if (data.code !== 1 || !data.data?.songs) {
        console.error('[MusicApi] getPlaylistSongsFromThirdParty 失败:', data.msg);
        return [];
      }

      const keywords = data.data.songs.map((s: string) => s.trim()).filter(Boolean);

      const searchResults = await this.batchSearch(keywords, sourceType);

      const songs: Song[] = [];
      for (const keyword of keywords) {
        const results = searchResults[keyword];
        if (results && results.length > 0) {
          songs.push(results[0]);
        }
      }

      return songs;
    } catch (error) {
      console.error('[MusicApi] getPlaylistSongsFromThirdParty 失败:', error);
      return [];
    }
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
   * 补齐无 URL 歌曲（专辑名预搜 1 次批量命中 + 剩余逐首兜底）。
   * 薄方法：包装 `resolveNeteaseSongUrlsBySearch`，返回补齐后的歌曲数组。
   */
  async fillSongUrls(songs: Song[], albumName?: string): Promise<Song[]> {
    const list = Array.isArray(songs) ? songs : [];
    await this.resolveNeteaseSongUrlsBySearch(list, albumName);
    return list;
  },

  async warmUpArtistPicCache(): Promise<void> {
    return warmUpArtistPicCache();
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

// 路由的 api 腿 = 自建 API 现状语义（搜索 POST / 播放直链解析）。
configureSourceRouter({
  searchSongs: (query, page, source) => musicApi.searchSongs(query, page, source),
  getAudioUrl: (url) => musicApi.getAudioUrl(url),
});
