/**
 * 端到端验证:用构建后的 @mplayer/core 真实调用网易云接口
 * 用法: node scripts/verify-netease-weapi.mjs [playlistId]
 */
import { musicApi } from '../packages/core/dist/index.js';

const playlistId = Number(process.argv[2] || 3778678);

const t0 = Date.now();
const songs = await musicApi.getNeteasePlaylistSongs(playlistId);
console.log(`getNeteasePlaylistSongs(${playlistId}) 耗时 ${Date.now() - t0}ms, 返回 ${songs.length} 首`);
const s = songs[0];
console.log('首曲:', JSON.stringify(s));

const t1 = Date.now();
const toplist = await musicApi.getNeteaseHotlist();
console.log(`getNeteaseHotlist 耗时 ${Date.now() - t1}ms, 返回 ${toplist.length} 首, 第1名: ${toplist[0]?.name} - ${toplist[0]?.artists}`);

const t2 = Date.now();
const detail = await musicApi.getNeteasePlaylistDetail(playlistId);
console.log(`getNeteasePlaylistDetail 耗时 ${Date.now() - t2}ms, 歌单: ${detail?.name} (${detail?.trackCount}首)`);
