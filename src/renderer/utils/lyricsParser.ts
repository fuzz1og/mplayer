export interface LyricLine {
  time: number;
  text: string;
}

export interface ParsedLyrics {
  lines: LyricLine[];
  hasTranslation: boolean;
}

export function parseLRC(lrcContent: string): ParsedLyrics {
  const lines: LyricLine[] = [];
  const lrcLines = lrcContent.split('\n');

  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const line of lrcLines) {
    const match = timeRegex.exec(line.trim());
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
      const text = match[4].trim();

      if (text) {
        const time = minutes * 60 + seconds + milliseconds / 1000;
        lines.push({ time, text });
      }
    }
  }

  lines.sort((a, b) => a.time - b.time);

  return {
    lines,
    hasTranslation: false
  };
}

export function findCurrentLyricIndex(lines: LyricLine[], currentTime: number): number {
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
