export interface LyricWord {
  /** 逐字起始时间（秒，相对歌曲开头） */
  time: number;
  /** 逐字持续时长（秒） */
  duration: number;
  /** 该字正文（整行正文 = 各字正文直接拼接） */
  text: string;
}

export interface LyricLine {
  time: number;
  text: string;
  /** 行内逐字时间轴；只有歌词源给了逐字轨道才存在，纯 LRC 行没有该字段 */
  words?: LyricWord[];
}

export interface ParsedLyrics {
  lines: LyricLine[];
  hasTranslation: boolean;
}

/** 行内逐字标签 `<a,b>`（酷我 lrcx）。a/b 是 obfuscated 编码，见 docs/research/2026-10-29-kuwo-lrcx-word-timed-lyrics.md */
const WORD_TAG_SOURCE = '<(-?\\d+),(-?\\d+)(?:,-?\\d+)?>';

/** 酷我 lrcx 文件头 `[kuwo:NNN]`：NNN 是八进制，拆成两位换算系数。 */
const KUWO_COEFFICIENTS_RE = /^\s*\[kuwo:([0-7]+)\]/m;

interface WordTimingCoefficients {
  k1: number;
  k2: number;
}

function readWordTimingCoefficients(lrcContent: string): WordTimingCoefficients | null {
  const match = KUWO_COEFFICIENTS_RE.exec(lrcContent);
  if (!match) return null;
  const value = parseInt(match[1], 8);
  const k1 = Math.floor(value / 10);
  const k2 = value % 10;
  return k1 > 0 && k2 > 0 ? { k1, k2 } : null;
}

function wordTagRegex(): RegExp {
  return new RegExp(WORD_TAG_SOURCE, 'g');
}

/** `[mm:ss.xx]` 之后的正文 → 剥掉逐字标签的正文 + （换算系数可得时）逐字时间轴 */
function parseWordTimedBody(
  body: string,
  lineTime: number,
  coefficients: WordTimingCoefficients | null
): { text: string; words?: LyricWord[] } {
  if (!body.includes('<')) return { text: body.trim() };

  const tagRe = wordTagRegex();
  const tags: { a: number; b: number; start: number; end: number }[] = [];
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(body)) !== null) {
    tags.push({ a: Number(tag[1]), b: Number(tag[2]), start: tag.index, end: tagRe.lastIndex });
  }

  const text = body.replace(wordTagRegex(), '').trim();
  // 缺换算系数、或整行标记都是 <0,0>（译文/占位行）时只剥标签，不给逐字轨道
  if (!coefficients || tags.length === 0 || tags.every((t) => t.a === 0 && t.b === 0)) {
    return { text };
  }

  const { k1, k2 } = coefficients;
  const spans = tags.map((t, index) => {
    const startMs = Math.abs(t.a + t.b) / (2 * k1);
    const durationMs = Math.abs(t.a - t.b) / (2 * k2);
    const segmentEnd = index + 1 < tags.length ? tags[index + 1].start : body.length;
    const segment = body.slice(t.end, segmentEnd);
    return {
      // 第一个标记之前若有正文，算进第一个词的文本（实测样本恒为空，兜底而已）
      text: index === 0 ? body.slice(0, t.start) + segment : segment,
      startMs,
      endMs: startMs + durationMs,
    };
  });

  // 后一个词的起点早于前一个词的终点时截断前一个词（与酷我客户端同款处理）
  for (let i = 1; i < spans.length; i++) {
    if (spans[i - 1].endMs > spans[i].startMs) {
      spans[i - 1].endMs = Math.max(spans[i - 1].startMs, spans[i].startMs);
    }
  }

  const words = spans.map((span) => ({
    time: lineTime + span.startMs / 1000,
    duration: (span.endMs - span.startMs) / 1000,
    text: span.text,
  }));

  return { text, words };
}

export function parseLRC(lrcContent: string): ParsedLyrics {
  const lines: LyricLine[] = [];
  const lrcLines = lrcContent.split('\n');
  const coefficients = readWordTimingCoefficients(lrcContent);

  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const line of lrcLines) {
    const match = timeRegex.exec(line.trim());
    if (!match) continue;

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
    const time = minutes * 60 + seconds + milliseconds / 1000;

    const { text, words } = parseWordTimedBody(match[4], time, coefficients);
    if (!text) continue;

    lines.push(words && words.length > 0 ? { time, text, words } : { time, text });
  }

  lines.sort((a, b) => a.time - b.time);

  return {
    lines,
    hasTranslation: false
  };
}

export function findCurrentLyricIndex(lines: ReadonlyArray<{ time: number }>, currentTime: number): number {
  if (lines.length === 0) return -1;

  let left = 0;
  let right = lines.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (lines[mid].time <= currentTime) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return right;
}

export function formatLyricsTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}]`;
}

export function generateLRC(lines: LyricLine[]): string {
  return lines
    .map(line => `${formatLyricsTime(line.time)}${line.text}`)
    .join('\n');
}
