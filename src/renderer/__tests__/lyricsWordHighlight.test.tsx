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

/** 当前行里带 data-sung 的词（行首 → 当前字，卡拉 OK 已唱区段） */
function sungWords(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.lyrics__line[data-active] .lyrics__word[data-sung]')]
    .map((word) => word.textContent ?? '');
}

describe('歌词逐字 sweep（#722）', () => {
  beforeEach(() => {
    playbackClock.destroy();
    sampledPosition = 1.6;
    playbackClock.connect(() => sampledPosition);
    playbackClock.setDuration(269);
    playbackClock.setPosition(1.6);
  });

  it('当前行正文不含行内标签，已唱区段从行首连续到当前字', () => {
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);

    expect(container.textContent).not.toContain('<');
    const activeLines = container.querySelectorAll('.lyrics__line[data-active]');
    expect(activeLines).toHaveLength(1);
    expect(activeLines[0].textContent).toBe('起风了 - 旺仔小乔');

    // 1.6s 落在第 4 个词「- 」（1516~1817ms）内：行首到它共 4 个词标已唱
    expect(sungWords(container)).toEqual(['起', '风', '了 ', '- ']);

    const flags = [...activeLines[0].querySelectorAll('.lyrics__word')].map((word) => word.hasAttribute('data-sung'));
    expect(flags).toEqual([true, true, true, true, false, false, false, false]);
    // 非当前行一个都不标
    expect(container.querySelectorAll('.lyrics__line:not([data-active]) .lyrics__word[data-sung]')).toHaveLength(0);
  });

  it('时间推进/回退时已唱区段随之变长/变短', () => {
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(sungWords(container)).toHaveLength(4);

    seek(0.5);
    expect(sungWords(container)).toEqual(['起']);

    seek(2.0);
    expect(sungWords(container)).toEqual(['起', '风', '了 ', '- ', '旺']);
    expect(container.querySelectorAll('.lyrics__line[data-active]')).toHaveLength(1);
  });

  it('纯 LRC 仍按整行渲染，不产生逐字 span', () => {
    const { container } = render(<LyricsDisplay lrcContent={PLAIN_LRC} />);

    expect(container.querySelectorAll('.lyrics__word')).toHaveLength(0);
    expect(container.querySelector('[data-sung]')).toBeNull();
    expect(container.querySelector('.lyrics__line[data-active]')?.textContent).toBe('故事的小黄花');
  });
});
