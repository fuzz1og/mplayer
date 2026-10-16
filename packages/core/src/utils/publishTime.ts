/**
 * 发行时间归一（#407 P0）：所有源的发行时间统一成 **epoch ms 字符串**；`''` = 源未提供或不可解析。必须归一——消费方一律
 * `new Date(Number(publishTime))`，而各源格式互不相同（网易毫秒、汽水秒、QQ `2026-07-26`、酷狗 `2026-07-04 00:00:00`）；
 * `Number('2026-07-26')` = NaN → 年份空，原始串不能透传。日期串按 **UTC 零点** 解析（按本地时区会漂移一天）。
 */

/**
 * **不能用 1e12**：那会把 1973–2001-09 之间的毫秒值（**12 位**，如陶喆《I Believe》2001 年的 
 * `996595200000`）误判成秒、再 ×1000，落到公元 33550 年。
 * 真机验收（2026-09-27）抓到的就是这个：歌手专辑时间线页的年份显示成 33550 / 32132 / 31908。
 */
const MS_THRESHOLD = 1e11;
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

export function normalizePublishTime(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'number') return fromEpoch(raw);
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return fromEpoch(Number(s));
  const m = DATE_RE.exec(s);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < YEAR_MIN || year > YEAR_MAX) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const ms = Date.UTC(year, month - 1, day, Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  return Number.isFinite(ms) && ms > 0 ? String(ms) : '';
}

function fromEpoch(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = n >= MS_THRESHOLD ? n : n * 1000;
  // 归一化后必须落在可解释的年份区间：微秒级输入（16 位）会算出公元 3 万年，
  // 与其显示一个荒谬年份，不如按「源未提供」处理（消费方按「无」渲染）。
  const year = new Date(ms).getFullYear();
  if (!Number.isFinite(year) || year < YEAR_MIN || year > YEAR_MAX) return '';
  return String(ms);
}
