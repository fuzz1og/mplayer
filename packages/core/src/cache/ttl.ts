export const DEFAULT_TTL = {
  search: 6 * 60 * 60 * 1000,      // 6 hours
  hotlist: 24 * 60 * 60 * 1000,    // 1 day
  audioUrl: 1 * 60 * 60 * 1000,    // 1 hour
  lyrics: 24 * 60 * 60 * 1000,      // 1 day
  cover: 6 * 60 * 60 * 1000,       // 6 hours
} as const
