/**
 * 发行时间归一（#407 P0）：所有源的发行时间统一成 **epoch ms 字符串**；`''` = 源未提供或不可解析。
 *
 * 为什么必须归一：消费方一律 `new Date(Number(publishTime))` 取年份/日期，而各源原始格式互不相同
 * （实测，见 #407 §8 的格式矩阵）：
 * - 网易 netease：数字毫秒（`1744646400000`）
 * - 汽水 / 部分源：数字秒（10 位）
 * - QQ：`2026-07-26`
 * - 酷狗：`2026-07-04 00:00:00`
 * - 千千：`releaseDate` 日期串
 * `Number('2026-07-26')` = NaN → 年份空，所以原始串不能透传。
 *
 * 日期串按 **UTC 零点** 解析：发行日期是「日」粒度的日历事实，按本地时区解析会随设备时区漂移一天。
 */

/** ≥ 1e12 视为毫秒；更小的纯数字按秒（10 位秒 ≈ 1.7e9，13 位毫秒 ≈ 1.7e12）。 */
const MS_THRESHOLD = 1e12;
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
  return String(n >= MS_THRESHOLD ? n : n * 1000);
}
