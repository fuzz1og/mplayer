import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * #608 守卫：桌面取词决策只允许一处——core planLyricsFetch。
 *
 * 此前同一个决策在桌面被写了两遍：播放侧（renderer playerStore）自判
 * songUsesSongidLyrics / isSodaSource / isInlineLyrics，下载侧车
 * （main downloadService）则只认 song.lrc、连既有计划都不走。
 * 两处现在都必须只消费 core 的 plan，本地不得再留取词分支判据。
 */
const ROOT = path.resolve(__dirname, '../..');

const CONSUMERS = [
  ['播放侧', path.join(ROOT, 'src', 'renderer', 'store', 'playerStore.ts')],
  ['下载侧车', path.join(ROOT, 'src', 'main', 'services', 'downloadService.ts')],
] as const;

describe('桌面取词决策单一来源 core planLyricsFetch（#608）', () => {
  it('⭐ 两处都消费 core plan：调用 planLyricsFetch，不再自留 songUsesSongidLyrics / isSodaSource 分支', () => {
    for (const [label, file] of CONSUMERS) {
      const src = fs.readFileSync(file, 'utf8');
      // 决策取自 core 单点……
      expect(src, label + ' 未消费 core planLyricsFetch').toMatch(/planLyricsFetch\(/);
      // ……自留的取词分支判据必须消失（否则就是第二份决策）。
      expect(src, label + ' 仍自留 songUsesSongidLyrics').not.toMatch(/songUsesSongidLyrics/);
      expect(src, label + ' 仍自留 isSodaSource').not.toMatch(/isSodaSource/);
    }
  });
});
