/**
 * 轻量 cookie 管理器（T13 spec #159，spec #146 决策 5 / #126/#130）。
 *
 * 目标：为各源直连（T07 酷狗等）提供统一的 cookie 生成 / 落盘 / 轮换接口。
 *
 * 设计：
 * - **生成逻辑全部纯函数**（可测）：网易匿名策略、MUSIC_U 借用（内部开关默认关）、
 *   酷狗设备 cookie 生成与轮换判定；
 * - **内存态管理器零 I/O**：默认即「移动端内存态」——不注册 persister 时纯内存，
 *   无任何文件/网络依赖，RN 可直接用；
 * - **持久化钩子**（桌面 adapter）：宿主（桌面主进程）注册 persister 落盘 db，
 *   core 内零 I/O（仿 T01 sourceRouter / T10 tlsFingerprint 模式）；
 * - **统一接口**：`generateCookie` / `getCookie` / `setCookie` / `refreshCookie` /
 *   `ensureFreshCookie` / `clearCookie` / `loadCookies`。
 * - 所有 cookie 均**程序化获取/生成**，无「必须用户 cookie」的源。
 */

// ── 常量 ──────────────────────────────────────────────────────────────

/** 网易 cookie 缺省有效期（12h）——匿名会话周期，到期轮换。 */
export const MANAGE_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;
/** 酷狗设备 cookie 缺省有效期（24h）——设备注册凭据，可独立配置轮换。 */
export const KUGOU_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

export type CookieSource = 'netease' | 'kugou';

/** 统一 cookie 形态：header value + 生成/到期时间（用于轮换判定）。 */
export interface SourceCookie {
  source: CookieSource;
  /** Cookie header 值；纯匿名源为空串。 */
  value: string;
  /** ISO 生成时间。 */
  generatedAt: string;
  /** ISO 到期时间。 */
  expiresAt: string;
  /** 附加元信息（匿名标记 / 酷狗 regist 字段等）。 */
  metadata?: Record<string, unknown>;
}

/** 时钟注入（默认 `Date.now`），便于纯函数轮换判定测试。 */
export type CookieClock = () => number;

// ── 纯函数生成器 ─────────────────────────────────────────────────────

function nowMs(clock?: CookieClock): number {
  return (clock ?? Date.now)();
}

function build(source: CookieSource, value: string, ttlMs: number, atMs: number, metadata?: Record<string, unknown>): SourceCookie {
  return {
    source,
    value,
    generatedAt: new Date(atMs).toISOString(),
    expiresAt: new Date(atMs + ttlMs).toISOString(),
    ...(metadata ? { metadata } : {}),
  };
}

/** 网易纯匿名 cookie：不携带任何用户凭据，value 为空串。 */
export function createNeteaseAnonymousCookie(clock?: CookieClock): SourceCookie {
  return build('netease', '', MANAGE_COOKIE_TTL_MS, nowMs(clock), { anonymous: true });
}

/** 网易借用 MUSIC_U 的 cookie（提升音质/VIP 检测）；默认关，仅显式开启时使用。 */
export function createNeteaseBorrowMusicUCookie(musicU: string, clock?: CookieClock): SourceCookie {
  return build('netease', `MUSIC_U=${musicU}`, MANAGE_COOKIE_TTL_MS, nowMs(clock), { anonymous: false });
}

/** 酷狗设备注册参数（T07 直连酷狗 gateway 需要的匿名设备凭据，程序化自建）。 */
export interface KugouDeviceReg {
  guid: string;
  mid: string;
  mac: string;
  dev: string;
  dfid: string;
}

/** 由设备注册参数生成酷狗设备 cookie 串（供 T07 消费）。 */
export function createKugouDeviceCookie(reg: KugouDeviceReg, clock?: CookieClock): SourceCookie {
  const value = [
    `KUGOU_API_GUID=${reg.guid}`,
    `KUGOU_API_MID=${reg.mid}`,
    `KUGOU_API_MAC=${reg.mac}`,
    `KUGOU_API_DEV=${reg.dev}`,
    `dfid=${reg.dfid}`,
  ].join('; ');
  return build('kugou', value, KUGOU_COOKIE_TTL_MS, nowMs(clock), {
    anonymous: true,
    guid: reg.guid,
    mid: reg.mid,
  });
}

/**
 * 轮换判定（纯函数）：已过期（超过 expiresAt）或不存在 → 应轮换；
 * 否则（还有效）不轮换。
 */
export function shouldRotateCookie(cookie: SourceCookie | null | undefined, clock?: CookieClock): boolean {
  if (!cookie) return true;
  return nowMs(clock) >= Date.parse(cookie.expiresAt);
}

// ── MUSIC_U 借用内部开关（默认关）────────────────────────────────────
//
// 网易 weapi 本身匿名可用；MUSIC_U 仅用于提升音质/VIP 检测（r1 矩阵 §1.3）。
// 作为「内部借用开关」默认关闭——不主动借用任何用户凭据，保持纯匿名直连。
// 若未来某源需要更高音质档可显式开启（需提供合法 MUSIC_U）。

let borrowMusicUEnabled = false;

export function getBorrowMusicUEnabled(): boolean {
  return borrowMusicUEnabled;
}

export function setBorrowMusicUEnabled(enabled: boolean): void {
  borrowMusicUEnabled = enabled;
}

// ── 内存态管理器（统一接口；零 I/O，默认即移动端内存态）──────────────

export interface GenerateCookieOptions {
  /** 时钟注入（测试）。 */
  clock?: CookieClock;
  /** 网易：借用 MUSIC_U 时的凭据（需 `setBorrowMusicUEnabled(true)` 才生效）。 */
  borrowMusicU?: string;
  /** 酷狗：设备注册参数。 */
  kugouReg?: KugouDeviceReg;
}

const cookies = new Map<CookieSource, SourceCookie>();
let persister: ((cookie: SourceCookie) => void) | null = null;

/** 宿主注册持久化回调（桌面 db / 移动端不注册即纯内存）。 */
export function setCookiePersister(persist: ((cookie: SourceCookie) => void) | null): void {
  persister = persist;
}

function persist(cookie: SourceCookie): void {
  persister?.(cookie);
}

/** 当前某个源的内存态 cookie；未生成返回 undefined。 */
export function getCookie(source: CookieSource): SourceCookie | undefined {
  return cookies.get(source);
}

/** 手动注入一个 cookie 并触发持久化。 */
export function setCookie(cookie: SourceCookie): void {
  cookies.set(cookie.source, cookie);
  persist(cookie);
}

/** 清空某个源的内存态并触发持久化（落盘空 cookie 表示清除）。 */
export function clearCookie(source: CookieSource): void {
  cookies.delete(source);
  persist({ source, value: '', generatedAt: new Date(0).toISOString(), expiresAt: new Date(0).toISOString() });
}

/**
 * 冷启动重水合：将磁盘读到的 cookies 载入内存，**不触发持久化**。
 * （桌面主进程启动时调用 loadCookies 注入；移动端内存态无需调用。）
 */
export function loadCookies(list: SourceCookie[]): void {
  for (const c of list) {
    if (c && c.source) cookies.set(c.source, c);
  }
}

/**
 * 统一生成入口：按源生成 cookie 并写入内存态 + 触发持久化。
 * 网易带 `borrowMusicU` 时是否走借用由 `setBorrowMusicUEnabled` 开关决定（默认关 → 纯匿名）。
 */
export function generateCookie(source: CookieSource, opts: GenerateCookieOptions = {}): SourceCookie {
  let cookie: SourceCookie;
  if (source === 'netease') {
    cookie = borrowMusicUEnabled && opts.borrowMusicU
      ? createNeteaseBorrowMusicUCookie(opts.borrowMusicU, opts.clock)
      : createNeteaseAnonymousCookie(opts.clock);
  } else {
    const reg = opts.kugouReg ?? randomKugouReg();
    cookie = createKugouDeviceCookie(reg, opts.clock);
  }
  cookies.set(source, cookie);
  persist(cookie);
  return cookie;
}

/** 酷狗缺省设备注册参数（程序化伪设备，逐字段随机——32hex guid/16hex mid/冒号 MAC，供无显式 reg 时兜底）。 */
export function randomKugouReg(): KugouDeviceReg {
  const hex = (len: number): string => {
    let out = '';
    for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  };
  const macParts: string[] = [];
  for (let i = 0; i < 6; i++) macParts.push(hex(2));
  return {
    guid: hex(32),
    mid: hex(16),
    mac: macParts.join(':'),
    dev: hex(16),
    dfid: hex(16),
  };
}

/**
 * 强制轮换：重新生成一个源的新 cookie（更新 generatedAt/expiresAt）。
 * 用于主动换凭据（避免长期同 cookie 被识别）。
 */
export function refreshCookie(source: CookieSource, opts: GenerateCookieOptions = {}): SourceCookie {
  return generateCookie(source, opts);
}

/**
 * 惰性轮换：若当前 cookie 仍有效则返回原 cookie（不重新生成），
 * 若已过期/不存在则重新生成。供每次请求前调用，避免不必要轮换。
 */
export function ensureFreshCookie(source: CookieSource, opts: GenerateCookieOptions = {}): SourceCookie {
  const existing = cookies.get(source);
  if (existing && !shouldRotateCookie(existing, opts.clock)) {
    return existing;
  }
  return generateCookie(source, opts);
}
