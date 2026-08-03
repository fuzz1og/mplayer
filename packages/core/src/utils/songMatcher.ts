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
    const nTargetArtist = normalize(target.artist);
    const candidateArtists = splitArtists(candidate.artist);
    let bestArtistScore = 0;
    for (const ca of candidateArtists) {
      const nCa = normalize(ca);
      if (nCa === nTargetArtist) {
        bestArtistScore = 1;
        break;
      }
      const score = levenshteinRatio(nTargetArtist, nCa);
      if (score > bestArtistScore) bestArtistScore = score;
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
