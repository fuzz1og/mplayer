import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const read = (rel: string) => readFileSync(join(testDir, '..', rel), 'utf8');

/**
 * #496：桌面端每个封面取图点都要过 core 的 `coverThumbUrl`（按源机制要缩略图）。
 * 一个 100 张的专辑网格拉原图是 ~27 MB；漏一个点就等于整页回退到原图。
 */
describe('桌面封面取图尺寸（#496）', () => {
  it('网格 / 卡片 / 头像 / 详情页 hero 都走 core 缩略图', () => {
    for (const [file, needle] of [
      ['components/AlbumGrid.tsx', 'coverThumbUrl(album.picUrl, COVER_SIZE.thumb)'],
      ['components/AlbumScroll.tsx', 'coverThumbUrl(album.picUrl, COVER_SIZE.icon)'],
      ['components/PlaylistGrid.tsx', 'coverThumbUrl(pl.coverImgUrl, COVER_SIZE.thumb)'],
      ['components/PlaylistPageGrid.tsx', 'coverThumbUrl(pl.coverImgUrl, COVER_SIZE.thumb)'],
      ['components/DiscoverPlaylistCard.tsx', 'coverThumbUrl(playlist.coverImgUrl, COVER_SIZE.thumb)'],
      ['pages/ArtistListPage.tsx', 'coverThumbUrl(artist.picUrl, COVER_SIZE.icon)'],
      ['pages/DiscoverPageV2.tsx', 'coverThumbUrl(a.picUrl, COVER_SIZE.icon)'],
      ['pages/AlbumDetailPage.tsx', 'coverThumbUrl(displayPic, COVER_SIZE.thumb)'],
      ['pages/ArtistDetailPage.tsx', 'coverThumbUrl(displayPic, COVER_SIZE.thumb)'],
      ['pages/DiscoverPlaylistDetailPage.tsx', 'coverThumbUrl(playlist.coverImgUrl, COVER_SIZE.thumb)'],
      ['components/ChartPanel.tsx', 'coverThumbUrl(song.cover, COVER_SIZE.row)'],
      ['components/DownloadProgressModal.tsx', 'coverThumbUrl(task.song.cover, COVER_SIZE.row)'],
    ] as const) {
      expect(read(file), file).toContain(needle);
    }
  });

  it('共享 SongCover 默认走 icon 档，大图卡片显式提档', () => {
    expect(read('components/SongCover.tsx')).toContain('thumbSize = COVER_SIZE.icon');
    expect(read('components/SongCover.tsx')).toContain('coverThumbUrl(src, thumbSize)');
    expect(read('components/DailyRecommend.tsx')).toContain('coverThumbUrl(featured.cover, COVER_SIZE.hero)');
  });
});
