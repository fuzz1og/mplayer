export interface MatchTarget {
  name: string;
  artist: string;
}

export interface MatchCandidate {
  name: string;
  artist: string;
}

const NAME_WEIGHT = 0.6;
const ARTIST_WEIGHT = 0.4;
const SIMILARITY_THRESHOLD = 0.6;
const SUBSTRING_SCORE = 0.8;

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s]/g, '')
    .replace(/[，、。！？；：""''【】《》（）[\]{}()\-—·…\u3000]/g, '');
}

function levenshteinRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[b.length][a.length];
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

function splitArtists(artist: string): string[] {
  const normalized = artist
    .replace(/\bfeat\.?\s*/gi, '||')
    .replace(/\bft\.?\s*/gi, '||');
  return normalized
    .split(/[、,，;；/＆&|]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function calculateSimilarity(target: MatchTarget, candidate: MatchCandidate): number {
  const nTarget = normalize(target.name);
  const nCandidate = normalize(candidate.name);

  let nameScore = 0;

  if (nTarget === nCandidate) {
    nameScore = 1;
  } else if (nTarget.includes(nCandidate) || nCandidate.includes(nTarget)) {
    nameScore = SUBSTRING_SCORE;
  } else {
    nameScore = levenshteinRatio(nTarget, nCandidate);
  }

  let artistScore = 0;
  if (target.artist && candidate.artist) {
    // target 也要拆分（"肖琴 / 肖Music" 须能匹配 candidate 任一歌手），
    // 与 isExactMatch 的拆分语义一致，避免多歌手目标被整体比较误拒
    const targetArtists = splitArtists(target.artist).map(normalize);
    const candidateArtists = splitArtists(candidate.artist);
    let bestArtistScore = 0;
    for (const nTa of targetArtists) {
      for (const ca of candidateArtists) {
        const nCa = normalize(ca);
        if (nCa === nTa) {
          bestArtistScore = 1;
          break;
        }
        const score = levenshteinRatio(nTa, nCa);
        if (score > bestArtistScore) bestArtistScore = score;
      }
      if (bestArtistScore === 1) break;
    }
    artistScore = bestArtistScore;
  } else {
    // If either target or candidate has no artist, skip artist matching
    artistScore = 1;
  }

  const combined = NAME_WEIGHT * nameScore + ARTIST_WEIGHT * artistScore;
  // artist 也必须达到阈值：防止同名不同歌手的翻唱/remix 被当作原唱
  // （name 完全匹配 + artist 完全不匹配 = 0.6，按原逻辑会误判为匹配）
  if (artistScore < SIMILARITY_THRESHOLD) return 0;
  return combined >= SIMILARITY_THRESHOLD ? combined : 0;
}

export function findBestMatch(
  target: MatchTarget,
  candidates: MatchCandidate[]
): { song: MatchCandidate; score: number } | null {
  let best: { song: MatchCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = calculateSimilarity(target, candidate);
    if (score > 0 && (!best || score > best.score)) {
      best = { song: candidate, score };
    }
  }
  return best;
}

/**
 * 精确匹配：name 与 artist 归一化后完全相等（双方多歌手都拆分，任一配对相等）。
 * 用于换源/播放兜底——findBestMatch 的 name substring 匹配会放行
 * "于是" 匹配 "于是(Live版)"，导致播放的音频与歌名歌手错位；
 * 精确匹配拒绝一切 Live/remix/翻唱变体，宁可匹配失败也不播错歌。
 */
export function isExactMatch(target: MatchTarget, candidate: MatchCandidate): boolean {
  const nTarget = normalize(target.name);
  const nCandidate = normalize(candidate.name);
  if (!nTarget || nTarget !== nCandidate) return false;
  if (!target.artist) return true; // 目标无歌手信息时只看歌名
  if (!candidate.artist) return false;
  // target 也要拆分："肖琴 / 肖Music" 必须能匹配 candidate 的任一歌手
  const targetArtists = splitArtists(target.artist).map(normalize);
  return splitArtists(candidate.artist).some((ca) => targetArtists.includes(normalize(ca)));
}

/** 在候选中找第一个精确匹配且有 url 的歌（无则返回 null） */
export function findExactMatch(target: MatchTarget, candidates: MatchCandidate[]): MatchCandidate | null {
  for (const candidate of candidates) {
    if (isExactMatch(target, candidate)) return candidate;
  }
  return null;
}
