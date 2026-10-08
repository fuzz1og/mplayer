/**
 * #607 守卫：桌面标签写入的**真实载体**特征化（真 mp3tag.js + music-metadata）。
 *
 * 本文件刻意**不 mock** mp3tag.js / music-metadata——要证的正是「第三方写进去的东西，
 * 标准读取方能不能读回来」。mock 掉就只剩自说自话（同 ADR 2026-10-04 对 FLAC 的要求）。
 *
 * 两组断言：
 * 1. 桌面 `writeMetadata` 对 M4A **一个字节都不写**（core `planAudioTagging` 判 skip）；
 * 2. 把同一份文件按**修正前**的方式喂给真 mp3tag.js，它只在 `moov > udta > meta` 里插
 *    一个 `ID32`（ID3v2-in-MP4），原 `ilst` 不动 → music-metadata 读不回标题。
 *    这就是「不能写」的原始证据（ADR `2026-10-08-download-tag-write-boundary.md`）。
 *
 * 若将来 mp3tag.js 支持 iTunes `ilst`（第 2 组断言变红），说明口径可以重开——那时应
 * 先更新 ADR 再放开，而不是把断言删掉。MP3 组是阳性对照：同一路径写得进也读得回。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseFile } from 'music-metadata';
import MP3Tag from 'mp3tag.js';
import { DownloadService } from '../../main/services/downloadService';
import type { Song } from '@mplayer/core';

const FIXTURES = join(__dirname, '../../../packages/core/src/shared/__tests__/fixtures');

/** iTunes `©nam` 与 mp3tag 的 `ID32`（M4A 的 atoms 是 `©xxx` 四字码） */
const ITUNES_TITLE_ATOM = Buffer.from([0xa9, 0x6e, 0x61, 0x6d]); // ©nam
const ID32_ATOM = Buffer.from('ID32', 'latin1');

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: '1',
    name: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    duration: 269,
    sourceType: 'netease',
    url: '',
    cover: '',
    lrc: '',
    ...overrides,
  };
}

/** 直接调私有 writeMetadata——本测试只关心「写入后载体长什么样」，不关心下载链路 */
function writeMetadata(service: DownloadService, song: Song, filePath: string): Promise<void> {
  return (service as unknown as { writeMetadata(s: Song, p: string): Promise<void> }).writeMetadata(song, filePath);
}

/**
 * 修正前桌面对 M4A 的调用序列（当时 core 判 m4a='mp4'、`strategy !== 'skip'` 就往下走）。
 * 现在生产代码已被 plan 拦下，所以取证必须在这里显式复现。
 */
async function mp3tagWriteLikePreFix(filePath: string, song: Song): Promise<void> {
  const buffer = readFileSync(filePath);
  const mp3tag = new MP3Tag(buffer);
  mp3tag.read();
  if (mp3tag.error) throw new Error(`mp3tag read 失败: ${mp3tag.error}`);
  mp3tag.tags.title = song.name || '';
  mp3tag.tags.artist = song.artist || '';
  mp3tag.tags.album = song.album || '';
  if (!mp3tag.tags.v2) (mp3tag.tags as unknown as Record<string, unknown>).v2 = {};
  mp3tag.tags.v2!.TIT2 = song.name || '';
  mp3tag.tags.v2!.TPE1 = song.artist || '';
  mp3tag.tags.v2!.TALB = song.album || '';
  mp3tag.save({ id3v2: { padding: 0 } }); // 修正前对 m4a 用 padding 0（见 git 历史）
  if (mp3tag.error) throw new Error(`mp3tag save 失败: ${mp3tag.error}`);
  const out = mp3tag.buffer instanceof ArrayBuffer ? Buffer.from(mp3tag.buffer) : (mp3tag.buffer as Buffer);
  writeFileSync(filePath, out);
}

describe('#607 桌面标签写入的真实载体（真 mp3tag.js + music-metadata）', () => {
  let dir: string;
  let service: DownloadService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mplayer-tag-'));
    service = new DownloadService();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('M4A：桌面不写（字节不变）；按修正前方式喂 mp3tag 则只多一个读不回的 ID32', async () => {
    const filePath = join(dir, 'sample.m4a');
    copyFileSync(join(FIXTURES, 'sample.m4a'), filePath);
    const before = readFileSync(filePath);
    expect((await parseFile(filePath)).common.title).toBeUndefined();

    // ① 现在：planAudioTagging 判 m4a=skip → 文件一个字节都不动
    await writeMetadata(service, makeSong(), filePath);
    expect(readFileSync(filePath).equals(before)).toBe(true);

    // ② 证据：同一份文件，按修正前的方式喂给真 mp3tag.js
    await mp3tagWriteLikePreFix(filePath, makeSong());
    const after = readFileSync(filePath);
    const meta = await parseFile(filePath);
    // 容器没被毁（区别于 FLAC 灌 ID3 那种真损坏）
    expect(meta.format.codec).toBe('MPEG-4/AAC');
    // 但写进去的**读不回**：这就是「不能写」的判据
    expect(meta.common.title).toBeUndefined();
    expect(meta.common.artist).toBeUndefined();
    // 落点是 ID32（非标准），不是 iTunes ilst 的 ©nam；原 ilst 未被合并
    expect(after.includes(ID32_ATOM)).toBe(true);
    expect(after.includes(ITUNES_TITLE_ATOM)).toBe(false);
  });

  it('MP3：同一路径写得进也读得回（阳性对照，证明上一条不是测试坏了）', async () => {
    const filePath = join(dir, 'sample.mp3');
    copyFileSync(join(FIXTURES, 'sample.mp3'), filePath);
    expect((await parseFile(filePath)).common.title).toBeUndefined();

    await writeMetadata(service, makeSong(), filePath);

    const meta = await parseFile(filePath);
    expect(meta.common.title).toBe('晴天');
    expect(meta.common.artist).toBe('周杰伦');
    expect(meta.common.album).toBe('叶惠美');
    expect(readFileSync(filePath).includes(ID32_ATOM)).toBe(false);
  });
});
