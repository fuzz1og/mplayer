import type { Song, SourceKey } from '../types/index.js';
import { request, bodyToText, type TransportRequest } from '../api/transport.js';
import { BROWSER_UA } from '../utils/sourceReferer.js';
import { isAudioBytes } from '../utils/sniffers.js';
import { isExactMatch, normalize } from '../utils/songMatcher.js';
import { stripSourceIdPrefix } from '../shared/resolvePlayableUrl.js';
import {
  setTier3Enabled as setRouterTier3Enabled,
  setTier3Resolver as setRouterTier3Resolver,
  setTier3SearchEnabled as setRouterTier3SearchEnabled,
  setTier3SearchResolver as setRouterTier3SearchResolver,
  type Tier3Resolver,
} from '../shared/sourceRouter.js';

/**
 * tier3Api —— 第三方解析源订阅执行器（#144）。
 *
 * 设计目标（spec #144）：
 * - 用户通过订阅 JSON 音源清单，为官方直连失败的歌曲提供可播 URL 兜底；
 * - 默认关闭、失败自动降级、公开仓库零端点（本文件不含任何第三方端点）；
 * - 仅执行「可纯声明描述的源」：url-resolver（按 id 直取）与
 *   search-then-resolve（先搜再解）；
 * - 安全：schema 校验 + 版本化 + 域名白名单 + 返回 URL 字节嗅探。
 *
 * 核心零 I/O：订阅拉取走统一 transport 接缝；本地文件由桌面宿主读文件后
 * 以文本形式交给本模块；移动端手动粘贴同理。
 */

// ── 类型 ─────────────────────────────────────────────────────────────

export type Tier3SourceKind = 'url-resolver' | 'search-then-resolve';

/** 一次声明式请求：url 为模板，支持 {id} {source} {name} {artist} {keyword}。 */
export interface Tier3RequestSpec {
  method?: 'GET' | 'POST';
  url: string;
  /** POST 请求体模板（原始填充，不 URL 编码）。 */
  body?: string;
  /** JSON 响应取值路径，如 `data.url` / `data.list`。 */
  responseJsonPath: string;
}

export interface Tier3SearchSpec extends Tier3RequestSpec {
  /** 搜索结果数组路径，如 `data.list`。 */
  itemsPath: string;
  /** 条目内歌名字段路径。 */
  namePath: string;
  /** 条目内歌手段路径（可选，缺省不校验歌手）。 */
  artistPath?: string;
  /** 条目内歌曲 id 字段路径（用于后续 resolve 步骤）。 */
  idPath?: string;
  /** 条目内直链字段路径（可选；命中则直接使用）。 */
  urlPath?: string;
  /** 条目内封面字段路径（可选；缺省尝试常见字段 pic/cover/img/albumPic）。 */
  coverPath?: string;
  /** 条目内专辑字段路径（可选；缺省尝试常见字段 album/albumName/albumTitle）。 */
  albumPath?: string;
}

export interface Tier3Source {
  /** 源代号（如 vkeys / gdstudio），仅用于日志与 UI 展示。 */
  id: string;
  name?: string;
  /** 该源适用的原始音源（如 qq/netease/kuwo）。url-resolver 建议必填，
   *  防止跨源时把 A 源的 id 当成 B 源的 id，解析出完全不同的歌。 */
  source?: string;
  kind: Tier3SourceKind;
  /** 返回音频 URL 的域名白名单；支持 `*.example.com` 通配子域。 */
  allowedDomains: string[];
  /** 单源超时（毫秒），默认 15000。 */
  timeoutMs?: number;
  /** 单源请求头（会合并到 API 请求与字节嗅探请求）。 */
  headers?: Record<string, string>;
  /** url-resolver 与 search-then-resolve 的取链步骤。 */
  resolve: Tier3RequestSpec;
  /** search-then-resolve 专用：搜索步骤。 */
  search?: Tier3SearchSpec;
}

export interface Tier3Manifest {
  version: 1;
  sources: Tier3Source[];
}

export type Tier3SubscriptionKind = 'url' | 'text' | 'file';

export interface Tier3Subscription {
  id: string;
  name: string;
  kind: Tier3SubscriptionKind;
  /** URL 订阅的地址 / 本地文件路径 / 手动粘贴的说明。 */
  source: string;
  manifest: Tier3Manifest;
  updatedAt: number;
}

export interface Tier3State {
  enabled: boolean;
  subscriptions: Tier3Subscription[];
}

export interface Tier3Deps {
  /** 测试/自定义请求入口；缺省走 core transport 默认实现。 */
  request?: (req: TransportRequest) => Promise<import('../api/transport.js').TransportResponse>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const SNIFF_TIMEOUT_MS = 8_000;

/** 试听片段大小阈值：<1MB 视为片段（与 api/audioProbe.ts 的 PREVIEW_THRESHOLD 对齐，
 *  30s 128kbps ≈ 480KB）。tier3 解析到片段时宁可跳过，也不把试听版当完整版播。 */
const TRIAL_BYTES_THRESHOLD = 1_048_576;

// ── 状态（core 零 I/O，宿主注册 persister 落盘）──────────────────────

let state: Tier3State = { enabled: false, subscriptions: [] };
let persister: ((next: Tier3State) => void) | null = null;

function persist(): void {
  persister?.({ ...state });
}

function syncRouter(): void {
  setRouterTier3Enabled(state.enabled);
  setRouterTier3Resolver(createTier3Resolver());
  setRouterTier3SearchEnabled(state.enabled);
  setRouterTier3SearchResolver(state.enabled ? searchTier3Songs : null);
}

export function setTier3Enabled(enabled: boolean): void {
  state = { ...state, enabled };
  syncRouter();
  persist();
}

export function getTier3Enabled(): boolean {
  return state.enabled;
}

export function setTier3Subscriptions(subscriptions: Tier3Subscription[]): void {
  state = { ...state, subscriptions };
  syncRouter();
  persist();
}

export function getTier3Subscriptions(): Tier3Subscription[] {
  return state.subscriptions;
}

export function getTier3State(): Tier3State {
  return { ...state, subscriptions: state.subscriptions.map((s) => ({ ...s })) };
}

/** 启动/测试重水合：不触发持久化，但同步路由插槽。 */
export function loadTier3State(saved: Partial<Tier3State> | undefined): void {
  state = {
    enabled: !!saved?.enabled,
    subscriptions: Array.isArray(saved?.subscriptions) ? saved.subscriptions : [],
  };
  syncRouter();
}

export function setTier3Persister(persist: ((next: Tier3State) => void) | null): void {
  persister = persist;
}

// ── 清单解析与校验 ───────────────────────────────────────────────────

const SOURCE_KINDS: ReadonlySet<string> = new Set(['url-resolver', 'search-then-resolve']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`清单校验失败：${label} 必须是非空字符串`);
  }
  return value.trim();
}

function assertHttpUrlTemplate(value: unknown, label: string): string {
  const url = assertString(value, label);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`清单校验失败：${label} 必须是 http(s) 模板`);
  }
  return url;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`清单校验失败：${label} 必须是非空数组`);
  }
  return value.map((v, i) => assertString(v, `${label}[${i}]`));
}

function assertOptionalHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('清单校验失败：headers 必须是对象');
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== 'string') throw new Error(`清单校验失败：headers.${key} 必须是字符串`);
    out[key] = val;
  }
  return out;
}

function parseRequestSpec(value: unknown, label: string): Tier3RequestSpec {
  if (!isRecord(value)) throw new Error(`清单校验失败：${label} 必须是对象`);
  const method = value.method === undefined ? 'GET' : value.method;
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`清单校验失败：${label}.method 只能是 GET 或 POST`);
  }
  const url = assertHttpUrlTemplate(value.url, `${label}.url`);
  const body = value.body === undefined ? undefined : assertString(value.body, `${label}.body`);
  const responseJsonPath = assertString(value.responseJsonPath, `${label}.responseJsonPath`);
  return { method, url, body, responseJsonPath };
}

function parseSearchSpec(value: unknown, label: string): Tier3SearchSpec {
  const base = parseRequestSpec(value, label);
  if (!isRecord(value)) throw new Error(`清单校验失败：${label} 必须是对象`);
  const itemsPath = assertString(value.itemsPath, `${label}.itemsPath`);
  const namePath = assertString(value.namePath, `${label}.namePath`);
  const artistPath = value.artistPath === undefined ? undefined : assertString(value.artistPath, `${label}.artistPath`);
  const idPath = value.idPath === undefined ? undefined : assertString(value.idPath, `${label}.idPath`);
  const urlPath = value.urlPath === undefined ? undefined : assertString(value.urlPath, `${label}.urlPath`);
  const coverPath = value.coverPath === undefined ? undefined : assertString(value.coverPath, `${label}.coverPath`);
  const albumPath = value.albumPath === undefined ? undefined : assertString(value.albumPath, `${label}.albumPath`);
  return { ...base, itemsPath, namePath, artistPath, idPath, urlPath, coverPath, albumPath };
}

function parseSource(value: unknown): Tier3Source {
  if (!isRecord(value)) throw new Error('清单校验失败：source 必须是对象');
  const id = assertString(value.id, 'source.id');
  const source = value.source === undefined ? undefined : assertString(value.source, `source(${id}).source`);
  const kind = assertString(value.kind, 'source.kind');
  if (!SOURCE_KINDS.has(kind)) {
    throw new Error(`清单校验失败：source.kind 不支持 ${kind}`);
  }
  const allowedDomains = assertStringArray(value.allowedDomains, `source(${id}).allowedDomains`);
  const timeoutMs = value.timeoutMs === undefined ? undefined : value.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error(`清单校验失败：source(${id}).timeoutMs 必须是正数`);
  }
  const headers = assertOptionalHeaders(value.headers);
  const resolve = parseRequestSpec(value.resolve, `source(${id}).resolve`);
  const search = kind === 'search-then-resolve'
    ? parseSearchSpec(value.search, `source(${id}).search`)
    : undefined;
  return {
    id,
    name: value.name === undefined ? undefined : assertString(value.name, `source(${id}).name`),
    source,
    kind: kind as Tier3SourceKind,
    allowedDomains,
    timeoutMs,
    headers,
    resolve,
    search,
  };
}

/**
 * 解析并校验订阅清单文本。
 * 版本化：当前仅接受 version=1；后续字段演进时在 parse 层做迁移/兼容。
 */
export function parseTier3Manifest(text: string): Tier3Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('订阅清单不是合法 JSON');
  }
  if (!isRecord(raw)) throw new Error('订阅清单必须是 JSON 对象');
  if (raw.version !== 1) {
    throw new Error(`订阅清单版本不支持：${String(raw.version)}（当前仅支持 1）`);
  }
  if (!Array.isArray(raw.sources)) throw new Error('订阅清单缺少 sources 数组');
  const sources = raw.sources.map(parseSource);
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) throw new Error(`订阅清单 source.id 重复：${source.id}`);
    seen.add(source.id);
  }
  return { version: 1, sources };
}

// ── JSON 路径取值 ────────────────────────────────────────────────────

function getByPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split('.')) {
    if (!part) continue;
    if (cur == null) return undefined;
    if (/^\d+$/.test(part)) {
      cur = Array.isArray(cur) ? cur[Number(part)] : undefined;
    } else if (isRecord(cur)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function toUrlCandidate(value: unknown): string | null {
  if (typeof value === 'string') {
    const url = value.trim();
    return /^https?:\/\//i.test(url) ? url : null;
  }
  if (isRecord(value)) {
    for (const key of ['url', 'src', 'audioUrl']) {
      const v = value[key];
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim();
    }
  }
  return null;
}

function asString(value: unknown): string {
  return value == null ? '' : String(value);
}

// ── 模板填充 ─────────────────────────────────────────────────────────

interface TemplateVars {
  id: string;
  source: string;
  name: string;
  artist: string;
  keyword: string;
}

function songVars(song: Song): TemplateVars {
  return {
    id: song.id ? stripSourceIdPrefix(song.id) : '',
    source: song.sourceType || '',
    name: song.name || '',
    artist: song.artist || '',
    keyword: `${song.name || ''} ${song.artist || ''}`.trim(),
  };
}

function fillTemplate(template: string, vars: TemplateVars, encode: boolean): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const raw = vars[key as keyof TemplateVars] ?? '';
    return encode ? encodeURIComponent(raw) : raw;
  });
}

function buildRequest(
  spec: Tier3RequestSpec,
  vars: TemplateVars,
  source: Tier3Source,
  responseType: 'text' | 'arraybuffer' = 'text',
): TransportRequest {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json',
    ...(source.headers || {}),
  };
  return {
    method: spec.method || 'GET',
    url: fillTemplate(spec.url, vars, true),
    headers,
    body: spec.body ? fillTemplate(spec.body, vars, false) : undefined,
    timeoutMs: source.timeoutMs || DEFAULT_TIMEOUT_MS,
    responseType,
  };
}

// ── 域名白名单 ───────────────────────────────────────────────────────

function normalizeDomain(entry: string): string {
  let d = entry.trim().toLowerCase().replace(/\.$/, '');
  if (d.startsWith('https://')) d = d.slice(8);
  else if (d.startsWith('http://')) d = d.slice(7);
  const slash = d.indexOf('/');
  if (slash >= 0) d = d.slice(0, slash);
  const at = d.lastIndexOf('@');
  if (at >= 0) d = d.slice(at + 1);
  const colon = d.lastIndexOf(':');
  if (colon >= 0 && /^\d+$/.test(d.slice(colon + 1))) d = d.slice(0, colon);
  return d.replace(/^\*\./, '');
}

function isAllowedHost(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedDomains.some((raw) => {
    const entry = normalizeDomain(raw);
    if (!entry) return false;
    // 显式 `*.example.com` 才放行子域；普通 `example.com` 只允许该域名本身。
    const wildcard = raw.trim().toLowerCase().startsWith('*.');
    if (wildcard) return host === entry || host.endsWith(`.${entry}`);
    return host === entry;
  });
}

function isAllowedUrl(url: string, allowedDomains: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    return isAllowedHost(host, allowedDomains);
  } catch {
    return false;
  }
}

// ── 字节嗅探 ─────────────────────────────────────────────────────────

/** 嗅探结果：ok = 前 1KB 是音频字节；totalBytes = 完整大小（CDN 支持 Range/Content-Length 时可得）。 */
interface SniffResult {
  ok: boolean;
  totalBytes: number | null;
}

async function sniffAudioUrl(url: string, source: Tier3Source, deps: Tier3Deps): Promise<SniffResult> {
  try {
    const req = deps.request || request;
    const res = await req({
      method: 'GET',
      url,
      headers: {
        Range: 'bytes=0-1023',
        'User-Agent': BROWSER_UA,
        ...(source.headers || {}),
      },
      timeoutMs: source.timeoutMs || SNIFF_TIMEOUT_MS,
      responseType: 'arraybuffer',
    });
    if (res.status >= 400) return { ok: false, totalBytes: null };
    const ct = String(res.headers['content-type'] || '');
    if (ct.includes('text/html')) return { ok: false, totalBytes: null };
    const bytes = res.body instanceof ArrayBuffer
      ? new Uint8Array(res.body)
      : new TextEncoder().encode(String(res.body));
    if (!isAudioBytes(bytes)) return { ok: false, totalBytes: null };
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
    return { ok: true, totalBytes };
  } catch {
    return { ok: false, totalBytes: null };
  }
}

/** 候选是否可接受：字节嗅探通过，且（拿不到大小时不臆断 / 大小 ≥ 试听片段阈值）。 */
function isAcceptableCandidate(sniff: SniffResult, source: Tier3Source, url: string): boolean {
  if (!sniff.ok) return false;
  if (sniff.totalBytes !== null && sniff.totalBytes < TRIAL_BYTES_THRESHOLD) {
    console.info(`[tier3] source=${source.id} 候选疑似试听片段（${sniff.totalBytes}B < 1MB），跳过: ${url}`);
    return false;
  }
  return true;
}

// ── 单源执行 ─────────────────────────────────────────────────────────

async function resolveFromRequestSpec(
  spec: Tier3RequestSpec,
  vars: TemplateVars,
  source: Tier3Source,
  deps: Tier3Deps,
): Promise<string> {
  const req = deps.request || request;
  const res = await req(buildRequest(spec, vars, source));
  if (res.status >= 400) return '';
  let body: unknown;
  try {
    body = JSON.parse(bodyToText(res.body));
  } catch {
    return '';
  }
  // 上游返回 HTTP 200 但业务错误封套（如 vkeys 的 {code:110000,message:"…"}）：
  // 记 warn 便于区分「上游挂了」与「无此歌」，避免日志里只有空洞的“未命中”。
  const code = getByPath(body, 'code');
  const message = getByPath(body, 'message');
  if (typeof code === 'number' && code !== 0 && typeof message === 'string' && message) {
    console.warn(`[tier3] source=${source.id} 上游返回错误: code=${code} message=${message}`);
    return '';
  }
  const candidate = toUrlCandidate(getByPath(body, spec.responseJsonPath));
  if (!candidate || !isAllowedUrl(candidate, source.allowedDomains)) return '';
  return isAcceptableCandidate(await sniffAudioUrl(candidate, source, deps), source, candidate) ? candidate : '';
}

async function resolveSourceUrl(
  song: Song,
  source: Tier3Source,
  idOverride?: string,
  itemMeta?: { name?: string; artist?: string },
): Promise<string> {
  const deps = currentDeps;
  const base = songVars(song);
  const name = itemMeta?.name || base.name;
  const artist = itemMeta?.artist || base.artist;
  const vars: TemplateVars = {
    ...base,
    id: idOverride || base.id,
    name,
    artist,
    keyword: `${name} ${artist}`.trim(),
  };
  return resolveFromRequestSpec(source.resolve, vars, source, deps);
}

async function resolveSearchThenResolve(song: Song, source: Tier3Source): Promise<string> {
  const deps = currentDeps;
  if (!source.search) return '';
  const vars = songVars(song);
  const req = deps.request || request;
  const res = await req(buildRequest(source.search, vars, source));
  if (res.status >= 400) return '';
  const items = getByPath(JSON.parse(bodyToText(res.body)), source.search.itemsPath);
  if (!Array.isArray(items)) return '';

  for (const item of items) {
    if (!isRecord(item)) continue;
    const itemName = asString(getByPath(item, source.search.namePath));
    const itemArtist = source.search.artistPath ? asString(getByPath(item, source.search.artistPath)) : '';
    // 严格匹配优先（拒绝翻唱/Live/remix/同名不同歌手）。降级仅当**目标歌手也为空**
    // （如 tier3 搜索兜底候选本身无歌手信息）时允许歌名精确匹配；目标歌手非空时，
    // 无歌手字段的候选一律拒绝——上游目录同名歌多（李荣浩/李寒/孟庭苇都有《恋人》），
    // 同名不同歌手的错播比「不播」更糟。
    const target = { name: song.name || '', artist: song.artist || '' };
    const candidate = { name: itemName, artist: itemArtist };
    const nameExact = !!target.name && normalize(target.name) === normalize(itemName);
    const matched =
      isExactMatch(target, candidate) ||
      (!normalize(itemArtist) && !normalize(target.artist) && nameExact);
    if (!matched) continue;

    if (source.search.urlPath) {
      const directUrl = toUrlCandidate(getByPath(item, source.search.urlPath));
      if (
        directUrl &&
        isAllowedUrl(directUrl, source.allowedDomains) &&
        isAcceptableCandidate(await sniffAudioUrl(directUrl, source, deps), source, directUrl)
      ) {
        return directUrl;
      }
    }

    if (source.resolve && source.search.idPath) {
      const itemId = asString(getByPath(item, source.search.idPath));
      if (itemId) {
        const resolved = await resolveSourceUrl(song, source, itemId, { name: itemName, artist: itemArtist });
        if (resolved) return resolved;
      }
    }
  }
  return '';
}

// ── 第三方搜索兜底（官方直连搜索失败时返回候选歌曲）──────────────────

interface Tier3SearchItem {
  id: string;
  name: string;
  artist: string;
  url: string;
  album: string;
  cover: string;
}

async function searchTier3SourceItems(source: Tier3Source, keyword: string): Promise<Tier3SearchItem[]> {
  if (source.kind !== 'search-then-resolve' || !source.search) return [];
  const deps = currentDeps;
  const vars: TemplateVars = {
    id: '',
    source: '',
    name: keyword,
    artist: '',
    keyword,
  };
  const req = deps.request || request;
  const res = await req(buildRequest(source.search, vars, source));
  if (res.status >= 400) return [];
  const items = getByPath(JSON.parse(bodyToText(res.body)), source.search.itemsPath);
  if (!Array.isArray(items)) return [];
  const out: Tier3SearchItem[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const name = asString(getByPath(item, source.search.namePath));
    if (!name) continue;
    const album =
      (source.search.albumPath ? asString(getByPath(item, source.search.albumPath)) : '') ||
      asString(getByPath(item, 'album') || getByPath(item, 'albumName') || getByPath(item, 'albumTitle'));
    const coverRaw =
      (source.search.coverPath ? asString(getByPath(item, source.search.coverPath)) : '') ||
      asString(getByPath(item, 'pic') || getByPath(item, 'cover') || getByPath(item, 'img') || getByPath(item, 'albumPic') || getByPath(item, 'image'));
    const cover = /^https?:\/\//i.test(coverRaw) ? coverRaw.replace(/^http:/, 'https:') : '';
    out.push({
      id: source.search.idPath ? asString(getByPath(item, source.search.idPath)) : '',
      name,
      artist: source.search.artistPath ? asString(getByPath(item, source.search.artistPath)) : '',
      url: source.search.urlPath ? (toUrlCandidate(getByPath(item, source.search.urlPath)) || '') : '',
      album,
      cover,
    });
  }
  return out;
}

/**
 * 第三方订阅搜索兜底：直连搜索失败时，用订阅清单里的 search-then-resolve 源
 * 按关键词返回候选歌曲。歌曲 url 可能为空，播放时仍可走 tier3 解析链。
 *
 * 注意：搜索兜底是「关键词候选」，不存在把 A 源 id 塞给 B 源解析器的错配风险
 * （source 防护只作用于播放解析 resolveTier3），因此**不按 source 过滤搜索源**；
 * 候选的 sourceType 标记为其真实来源（tier3SourceSource 推断，如 mitu→kuwo），
 * 让点击播放时解析链的 source 防护与候选一致，而不是伪装成查询源。
 */
export async function searchTier3Songs(keyword: string, _page: number, sourceKey: SourceKey): Promise<Song[]> {
  if (!state.enabled || state.subscriptions.length === 0) return [];
  console.info(`[tier3] 第三方搜索开始: ${keyword} (${sourceKey})`);
  const out: Song[] = [];
  const seen = new Set<string>();
  for (const subscription of state.subscriptions) {
    for (const source of subscription.manifest.sources) {
      if (source.kind !== 'search-then-resolve' || !source.search) continue;
      console.info(`[tier3] 源 ${source.id} 搜索请求: ${keyword}`);
      try {
        const items = await searchTier3SourceItems(source, keyword);
        // 只保留歌名与查询词强相关的候选：归一化后歌名必须等于查询词、或为查询词
        // 的一部分（查询词更具体，如「恋人 李荣浩」可匹配「恋人」）；反向
        // （「恋人」匹配「恋人未满」）会端上完全不同的歌，一律丢弃。
        // 多词查询的每个词都要出现在歌名或歌手里（「恋人 李荣浩」要求歌手含李荣浩）。
        const tokens = keyword
          .trim()
          .split(/[\s,，、;；&|/]+/)
          .map((t) => normalize(t))
          .filter(Boolean);
        const qName = tokens.join('');
        for (const item of items) {
          const itemName = normalize(item.name);
          if (!itemName || (itemName !== qName && !qName.includes(itemName))) continue;
          const itemArtist = normalize(item.artist);
          if (tokens.some((t) => !itemName.includes(t) && !itemArtist.includes(t))) continue;
          // 多个订阅/源可能指向同一上游，按“歌名+歌手”去重，避免结果重复。
          const dedupeKey = `${item.name.trim().toLowerCase()}|${item.artist.trim().toLowerCase()}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          out.push({
            id: item.id ? `tier3:${source.id}:${item.id}` : `tier3:${source.id}:${out.length}`,
            name: item.name,
            artist: item.artist,
            album: item.album,
            url: item.url,
            cover: item.cover,
            lrc: '',
            duration: 0,
            sourceType: tier3SourceSource(source) || sourceKey,
          });
        }
        console.info(`[tier3] 源 ${source.id} 返回 ${items.length} 条候选`);
      } catch (e) {
        console.warn(`[tier3] 源 ${source.id} 搜索失败: ${(e as Error)?.message || e}`);
      }
    }
  }
  return out;
}

// ── 订阅源拉取 ───────────────────────────────────────────────────────

export async function fetchTier3ManifestFromUrl(url: string): Promise<Tier3Manifest> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('订阅 URL 不合法');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('订阅 URL 必须是 http(s)');
  }
  const req = currentDeps.request || request;
  const res = await req({
    method: 'GET',
    url,
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    responseType: 'text',
  });
  if (res.status >= 400) {
    throw new Error(`订阅清单拉取失败：HTTP ${res.status}`);
  }
  return parseTier3Manifest(bodyToText(res.body));
}

// ── 订阅管理 ─────────────────────────────────────────────────────────

function subscriptionId(source: string): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${source.length}`;
}

function manifestDisplayName(manifest: Tier3Manifest): string {
  const first = manifest.sources[0];
  return first?.name || first?.id || '第三方音源';
}

export async function addTier3SubscriptionFromUrl(
  input: { name?: string; url: string },
): Promise<Tier3Subscription> {
  const manifest = await fetchTier3ManifestFromUrl(input.url);
  const subscription: Tier3Subscription = {
    id: subscriptionId(input.url),
    name: input.name?.trim() || manifestDisplayName(manifest),
    kind: 'url',
    source: input.url,
    manifest,
    updatedAt: Date.now(),
  };
  setTier3Subscriptions([...state.subscriptions, subscription]);
  return subscription;
}

export function addTier3SubscriptionFromText(
  input: { name?: string; text: string; kind?: Tier3SubscriptionKind; source?: string },
): Tier3Subscription {
  const manifest = parseTier3Manifest(input.text);
  const sourceLabel = input.source?.trim() || input.name?.trim() || '手动粘贴清单';
  const subscription: Tier3Subscription = {
    id: subscriptionId(sourceLabel),
    name: input.name?.trim() || manifestDisplayName(manifest),
    kind: input.kind || 'text',
    source: sourceLabel,
    manifest,
    updatedAt: Date.now(),
  };
  setTier3Subscriptions([...state.subscriptions, subscription]);
  return subscription;
}

export function removeTier3Subscription(id: string): void {
  setTier3Subscriptions(state.subscriptions.filter((s) => s.id !== id));
}

export async function refreshTier3Subscription(id: string): Promise<Tier3Subscription> {
  const existing = state.subscriptions.find((s) => s.id === id);
  if (!existing) throw new Error('订阅不存在');
  if (existing.kind !== 'url') {
    // text/file 订阅的清单已持久化在本地，无需重新拉取；直接返回当前值。
    return existing;
  }
  const manifest = await fetchTier3ManifestFromUrl(existing.source);
  const next: Tier3Subscription = { ...existing, manifest, updatedAt: Date.now() };
  setTier3Subscriptions(state.subscriptions.map((s) => (s.id === id ? next : s)));
  return next;
}

// ── 顶层解析入口 ─────────────────────────────────────────────────────

let currentDeps: Tier3Deps = {};

/** 注入默认执行依赖（主要供测试替换 transport；生产可不调用，走 core 默认 request）。 */
export function setTier3Deps(deps: Tier3Deps): void {
  currentDeps = deps;
}

/** 源适用的原始音源：显式声明的 source 优先；未声明时从 URL 形态推断（两种 kind 都推断，
 *  避免酷我/酷狗等歌曲把自身 id 塞给 QQ/网易专用解析接口，导致返回完全不同的歌）。 */
export function tier3SourceSource(source: Tier3Source): string | undefined {
  if (source.source) return source.source;
  const url = `${source.resolve.method || 'GET'} ${source.resolve.url} ${source.search?.url || ''}`.toLowerCase();
  if (url.includes('tencent') || url.includes('/qq') || url.includes('qqmusic')) return 'qq';
  if (url.includes('netease') || url.includes('music.163') || url.includes('126.net')) return 'netease';
  if (url.includes('kuwo') || url.includes('kw.php')) return 'kuwo';
  if (url.includes('kugou')) return 'kugou';
  if (url.includes('migu')) return 'migu';
  if (url.includes('qianqian') || url.includes('91q.com')) return 'qianqian';
  if (url.includes('soda') || url.includes('qishui')) return 'soda';
  return undefined;
}

async function resolveTier3(song: Song): Promise<string> {
  if (!state.enabled) {
    console.info(`[tier3] 未启用，跳过: 《${song.name}》${song.artist}`);
    return '';
  }
  if (state.subscriptions.length === 0) {
    console.info(`[tier3] 已启用但无订阅，跳过: 《${song.name}》${song.artist}`);
    return '';
  }
  console.info(`[tier3] 开始解析: 《${song.name}》${song.artist} (${song.sourceType}, id=${song.id})`);
  for (const subscription of state.subscriptions) {
    for (const source of subscription.manifest.sources) {
      const effectiveSource = tier3SourceSource(source);
      if (effectiveSource && effectiveSource !== song.sourceType) {
        console.info(`[tier3] 源 ${source.id} 跳过（source mismatch: ${effectiveSource} != ${song.sourceType}）`);
        continue;
      }
      try {
        let url = '';
        if (source.kind === 'url-resolver') {
          url = await resolveSourceUrl(song, source);
        } else {
          url = await resolveSearchThenResolve(song, source);
        }
        if (url) {
          console.info(`[tier3] 命中 source=${source.id}: ${url}`);
          return url;
        }
        console.info(`[tier3] source=${source.id} 未命中`);
      } catch (e) {
        console.warn(`[tier3] source=${source.id} 失败: ${(e as Error)?.message || e}`);
        // 单源失败继续下一条；全失败返回空串由 sourceRouter 回退。
      }
    }
  }
  console.warn(`[tier3] 全部订阅源未命中，回退下一链路: 《${song.name}》${song.artist}`);
  return '';
}

/** 供 sourceRouter 注入的 resolver（读取实时订阅状态）。 */
export function createTier3Resolver(): Tier3Resolver {
  return resolveTier3;
}
