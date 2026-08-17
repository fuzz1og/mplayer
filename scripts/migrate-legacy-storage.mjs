#!/usr/bin/env node
/**
 * 自建 API 退役后的本地数据迁移脚本。
 *
 * 只做两件安全的事：
 * 1. storage.json：把歌曲 ID 统一成字符串，清掉指向旧会话签名端点
 *    （api.php?get=...）的 url/cover/lrc，删除过期的 audioTag/nonFull；
 *    不删除任何收藏/歌单/历史。
 * 2. 磁盘缓存：删除这些旧歌曲对应的 song 资源缓存，以及 key 里含旧端点的封面缓存。
 *
 * 用法：
 *   node scripts/migrate-legacy-storage.mjs [--file=C:\path\to\storage.json] [--keep-backup]
 * 不传 --file 时默认读取 %APPDATA%\mplayer\data\storage.json。
 * 默认不保留原始备份（避免旧签名端点信息残留在本机）；需要备份时传 --keep-backup。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function isLegacyDeadUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('api.php') && parsed.searchParams.has('get');
  } catch {
    // ignore
  }
  return false;
}

function clearLegacyResources(song) {
  let changed = false;
  for (const field of ['url', 'cover', 'lrc']) {
    if (isLegacyDeadUrl(song?.[field])) {
      song[field] = '';
      changed = true;
    }
  }
  if (song && 'audioTag' in song) {
    delete song.audioTag;
    changed = true;
  }
  if (song && 'nonFull' in song) {
    delete song.nonFull;
    changed = true;
  }
  return changed;
}

function normalizeEntry(entry, songIds) {
  let changed = false;
  if (!entry || typeof entry !== 'object') return false;
  if (entry.songId != null && typeof entry.songId !== 'string') {
    entry.songId = String(entry.songId);
    changed = true;
  }
  const song = entry.song;
  if (song && typeof song === 'object') {
    if (song.id != null && typeof song.id !== 'string') {
      song.id = String(song.id);
      changed = true;
    }
    if (clearLegacyResources(song)) changed = true;
    if (song.id) songIds.add(String(song.id));
  }
  return changed;
}

function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function tryUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.warn(`删除失败（可能被 App 占用）: ${filePath} - ${error.message}`);
  }
  return false;
}

function removeCacheKey(cacheDir, rawKey) {
  const hash = md5(rawKey);
  let removed = 0;
  for (const sub of ['json', 'bin']) {
    if (tryUnlink(path.join(cacheDir, sub, hash))) removed++;
    if (tryUnlink(path.join(cacheDir, 'meta', `${hash}.json`))) removed++;
  }
  return removed;
}

function main() {
  const fileFlag = process.argv.find((arg) => arg.startsWith('--file='));
  const keepBackup = process.argv.includes('--keep-backup');
  const storagePath = fileFlag
    ? fileFlag.slice('--file='.length)
    : path.join(process.env.APPDATA || '', 'mplayer', 'data', 'storage.json');

  if (!fs.existsSync(storagePath)) {
    console.error(`找不到 storage.json: ${storagePath}`);
    process.exit(1);
  }

  const dataDir = path.dirname(storagePath);
  const data = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
  const songIds = new Set();
  let changedEntries = 0;

  for (const favorite of data.favorites || []) {
    if (normalizeEntry(favorite, songIds)) changedEntries++;
  }
  for (const historyItem of data.playHistory || []) {
    if (normalizeEntry(historyItem, songIds)) changedEntries++;
  }
  for (const playlistSong of data.playlistSongs || []) {
    if (normalizeEntry(playlistSong, songIds)) changedEntries++;
  }

  if (changedEntries > 0) {
    if (keepBackup) {
      const backupPath = path.join(dataDir, `storage.json.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.copyFileSync(storagePath, backupPath);
      console.log(`已备份: ${backupPath}`);
    }
    const tmpPath = storagePath + '.migrate.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, storagePath);
    console.log(`storage.json 已迁移（改动 ${changedEntries} 条）`);
  } else {
    console.log('storage.json 无需迁移');
  }

  const cacheDir = path.join(path.dirname(dataDir), 'cache');
  let removedCache = 0;
  if (fs.existsSync(path.join(cacheDir, 'meta'))) {
    // 1) 删除旧歌曲资源缓存（旧键是 :json:song:<id> / :bin:song:<id> 等变体）
    for (const id of songIds) {
      for (const raw of [
        `song:${id}`,
        `json:song:${id}`,
        `bin:song:${id}`,
        `:json:song:${id}`,
        `:bin:song:${id}`,
        `url:${id}`,
        `json:url:${id}`,
        `bin:url:${id}`,
        `:json:url:${id}`,
        `:bin:url:${id}`,
      ]) {
        removedCache += removeCacheKey(cacheDir, raw);
      }
    }

    // 2) 删除 key 里含旧端点的封面缓存（meta 里存了原始 key）
    const metaDir = path.join(cacheDir, 'meta');
    for (const metaFile of fs.readdirSync(metaDir).filter((f) => f.endsWith('.json'))) {
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(path.join(metaDir, metaFile), 'utf-8'));
      } catch {
        continue;
      }
      if (!meta?.key || !/api\.php\?get=/.test(meta.key)) continue;
      for (const sub of ['json', 'bin']) {
        if (tryUnlink(path.join(cacheDir, sub, metaFile.replace(/\.json$/, '')))) removedCache++;
      }
      if (tryUnlink(path.join(metaDir, metaFile))) removedCache++;
    }
  }

  console.log(`已清理旧缓存条目: ${removedCache} 个文件`);
  console.log(`迁移完成。受影响歌曲 ID 数: ${songIds.size}`);
  console.log('提示：如果 App 正在运行，请重启后再打开收藏/歌单。');
}

main();
