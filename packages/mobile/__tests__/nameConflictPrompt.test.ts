import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ alert: vi.fn() }));

// 本地覆盖 setup.ts 的 react-native 替身：本用例只关心 Alert 收到的文案与回调
vi.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => h.alert(...args) },
}));

import { NAME_CONFLICT_COPY } from '@mplayer/core';
import type { PlaylistNameConflict, Song } from '@mplayer/core';
import { promptNameConflict } from '../components/nameConflictPrompt';

const song = (id: string, sourceType: Song['sourceType']): Song => ({
  id,
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType,
});

const conflict = (id: string): PlaylistNameConflict => ({
  song: song(id, 'qq'),
  existingSong: song('n1', 'netease'),
});

interface AlertButton {
  text?: string;
  style?: string;
  onPress?: () => void;
}

/** 取最后一次 Alert 的入参（title / message / buttons / options）。 */
function lastAlert() {
  const call = h.alert.mock.calls.at(-1) as unknown[];
  return {
    title: call[0] as string,
    message: call[1] as string,
    buttons: call[2] as AlertButton[],
    options: call[3] as { cancelable?: boolean; onDismiss?: () => void } | undefined,
  };
}

beforeEach(() => {
  h.alert.mockReset();
});

/**
 * #560：移动端「批量加入已有歌单」遇同名异源时必须**问用户**，且与桌面问的是同一句话。
 *
 * 修前：批量腿不传 resolveNameConflict → core 走默认并入，用户没得拒绝（桌面会问）。
 * 这组用例同时钉住「问什么」（文案取自 core，不各自硬编码）与「答什么」
 * （继续添加 = add / 取消 = skip），以及「弹层被吃掉也要 resolve，不把写入挂死」。
 */
describe('#560：移动端同名异源确认（resolveNameConflict 的 RN 渲染）', () => {
  it('文案逐字取自 core NAME_CONFLICT_COPY，冲突条数进正文', async () => {
    const asked = promptNameConflict([conflict('a'), conflict('b')]);
    const alert = lastAlert();

    expect(alert.title).toBe(NAME_CONFLICT_COPY.title);
    expect(alert.message).toBe(NAME_CONFLICT_COPY.message(2));
    expect(alert.message).toContain('2 首');
    expect(alert.buttons.map((b) => b.text)).toEqual([
      NAME_CONFLICT_COPY.cancelText,
      NAME_CONFLICT_COPY.confirmText,
    ]);

    alert.buttons[1].onPress?.();
    await expect(asked).resolves.toBe('add');
  });

  it('单条冲突：正文用 1 首（不是写死的复数）', async () => {
    const asked = promptNameConflict([conflict('a')]);
    expect(lastAlert().message).toBe(NAME_CONFLICT_COPY.message(1));
    expect(lastAlert().message).toContain('1 首');
    lastAlert().buttons[1].onPress?.();
    await asked;
  });

  it('「取消」= skip：放弃这些同名歌（core 据此丢弃并计入 skipped）', async () => {
    const asked = promptNameConflict([conflict('a')]);
    lastAlert().buttons[0].onPress?.();
    await expect(asked).resolves.toBe('skip');
  });

  it('弹层被系统吃掉（dismiss）也要 resolve，不把写入路径挂死', async () => {
    const asked = promptNameConflict([conflict('a')]);
    const { options } = lastAlert();
    // 返回键/点外部会让 Promise 永不结算 —— 那是「写入静默挂住」的形态
    expect(options?.cancelable).toBe(false);
    options?.onDismiss?.();
    await expect(asked).resolves.toBe('skip');
  });
});
