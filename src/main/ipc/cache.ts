import { registerIpcHandlerSimple } from './registerHandler';
import { getCacheManager } from '../cache/cacheManager';

export function registerCacheIpc(): void {
  const cm = getCacheManager();
  registerIpcHandlerSimple('cache:getSong', (keyword: string) => cm.getSongCache(keyword));
  registerIpcHandlerSimple('cache:setSong', (keyword: string, songs: any[]) => cm.setSongCache(keyword, songs));
  registerIpcHandlerSimple('cache:getCover', (coverUrl: string) => cm.getCoverCache(coverUrl));
  registerIpcHandlerSimple('cache:setCover', (coverUrl: string, imageData: Buffer) => cm.setCoverCache(coverUrl, imageData));
  registerIpcHandlerSimple('cache:getAudio', (audioUrl: string) => cm.getAudioCache(audioUrl));
  registerIpcHandlerSimple('cache:setAudio', (audioUrl: string, audioData: Buffer) => cm.setAudioCache(audioUrl, audioData));
  registerIpcHandlerSimple('cache:getUrl', (songId: string) => cm.getUrlCache(songId));
  registerIpcHandlerSimple('cache:setUrl', (songId: string, urlData: any) => cm.setUrlCache(songId, urlData));
  registerIpcHandlerSimple('cache:clear', () => cm.clearAllCache());
  registerIpcHandlerSimple('cache:getStats', () => cm.getCacheStats());
}
