import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import LyricsDisplay from '@/renderer/components/LyricsDisplay';
import { playbackClock } from '@/renderer/services/playbackClock';

const fixturesDir = join(dirname(fileURLToPath(String(import.meta.url))), 'fixtures');
const kuwoLrcx = readFileSync(join(fixturesDir, 'kuwo-lrcx-075.txt'), 'utf8');
const PLAIN_LRC = '[00:00.00]故事的小黄花\n[00:04.00]从出生那年就飘着';

/** 采样源读同一个可变值：时钟 tick 复核时不会把 seek 后的位置弹回去 */
let sampledPosition = 0;

function seek(position: number): void {
  sampledPosition = position;
  act(() => {
    playbackClock.setPosition(position);
  });
}

describe('歌词逐字高亮（#722）', () => {
  beforeEach(() => {
    playbackClock.destroy();
    sampledPosition = 1.6;
    playbackClock.connect(() => sampledPosition);
    playbackClock.setDuration(269);
    playbackClock.setPosition(1.6);
  });

  it('当前行正文不含行内标签，当前词单独标 data-active', () => {
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);

    expect(container.textContent).not.toContain('<');
    const activeLines = container.querySelectorAll('.lyrics__line[data-active]');
    expect(activeLines).toHaveLength(1);
    expect(activeLines[0].textContent).toBe('起风了 - 旺仔小乔');
    // 1.6s 落在「- 」（1516~1817ms）
    const activeWords = container.querySelectorAll('.lyrics__word[data-active]');
    expect(activeWords).toHaveLength(1);
    expect(activeWords[0].textContent).toBe('- ');
  });

  it('同一行内换字只挪 data-active 的位置', () => {
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(container.querySelector('.lyrics__word[data-active]')?.textContent).toBe('- ');

    seek(2.0);
    expect(container.querySelector('.lyrics__word[data-active]')?.textContent).toBe('旺');
    expect(container.querySelectorAll('.lyrics__line[data-active]')).toHaveLength(1);
  });

  it('纯 LRC 仍按整行渲染，不产生逐字 span', () => {
    const { container } = render(<LyricsDisplay lrcContent={PLAIN_LRC} />);

    expect(container.querySelectorAll('.lyrics__word')).toHaveLength(0);
    expect(container.querySelector('.lyrics__line[data-active]')?.textContent).toBe('故事的小黄花');
  });
});
