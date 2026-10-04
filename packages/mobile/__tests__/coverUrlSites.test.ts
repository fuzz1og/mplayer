import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** 读仓库内源文件（vitest root = packages/mobile） */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');

/**
 * #496 的取图尺寸守卫：**每个取图点都按显示尺寸要缩略图**，
 * 且规则**只在 core 一处**（`COVER_SIZE` + `coverThumbUrl`）——两端不许各写一份。
 */
describe('封面取图尺寸（#496）', () => {
  it('不过 LazyCover 的裸图点也按档位要图', () => {
    expect(read('components/CollapsingHero.tsx')).toContain('coverThumbUrl(cover, COVER_SIZE.hero)');
    expect(read('components/PlayerBar.tsx')).toContain('coverThumbUrl(currentSong.cover, COVER_SIZE.icon)');
    expect(read('components/PlayerOverlay.tsx')).toContain('coverThumbUrl(song.cover, COVER_SIZE.hero)');
    // 内嵌到文件的封面同样要缩略档：它直接决定每个下载文件变大多少
    expect(read('services/downloadService.ts')).toContain('coverThumbUrl(coverUrl, COVER_SIZE.embed)');
  });

  it('歌曲行（列表里数量最多）按 row 档位取', () => {
    expect(read('components/SongRow.tsx')).toContain('thumbSize={COVER_SIZE.row}');
  });

  it('规则单点在 core：移动端不再自带第二份实现', () => {
    expect(read('components/LazyCover.tsx')).toContain("import { COVER_SIZE, coverThumbUrl } from '@mplayer/core'");
    expect(existsSync(join(testDir, '..', 'utils/coverUrl.ts'))).toBe(false);
  });
});
