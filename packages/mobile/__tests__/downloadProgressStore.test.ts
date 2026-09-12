import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROGRESS_THROTTLE_MS, useDownloadProgressStore } from '../stores/downloadProgressStore';
import { useDownloadStore, type DownloadItem } from '../stores/downloadStore';

const asyncStorageMock = AsyncStorage as unknown as {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};

const ITEM: DownloadItem = {
  key: 'netease:1',
  songId: '1',
  name: '晴天',
  artist: '周杰伦',
  fileName: '晴天 - 周杰伦.mp3',
  status: 'downloading',
  addedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useDownloadProgressStore.getState().reset();
  useDownloadStore.setState({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('downloadProgressStore（下载进度瞬时读模型）', () => {
  it('节流：100 个进度事件 / 1s 最多按时间窗次数通知（不逐条重渲染）', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = useDownloadProgressStore.subscribe(listener);

    for (let i = 1; i <= 99; i++) {
      vi.setSystemTime(i * 10);
      useDownloadProgressStore.getState().reportProgress('netease:1', i);
    }

    const maxNotifications = Math.ceil(1000 / PROGRESS_THROTTLE_MS) + 1;
    expect(listener.mock.calls.length).toBeGreaterThan(0);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(maxNotifications);
    expect(useDownloadProgressStore.getState().progressByKey['netease:1']).toBeLessThan(100);
    unsubscribe();
  });

  it('100（完成）永远放行，不被节流窗口吞掉', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    useDownloadProgressStore.getState().reportProgress('netease:1', 40);
    vi.setSystemTime(1010); // 仍在窗口内
    useDownloadProgressStore.getState().reportProgress('netease:1', 100);

    expect(useDownloadProgressStore.getState().progressByKey['netease:1']).toBe(100);
  });

  it('clearProgress 清掉进度并重置节流窗口（重试/重下不被吞）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    useDownloadProgressStore.getState().reportProgress('netease:1', 30);
    expect(useDownloadProgressStore.getState().progressByKey['netease:1']).toBe(30);

    useDownloadProgressStore.getState().clearProgress('netease:1');
    expect(useDownloadProgressStore.getState().progressByKey['netease:1']).toBeUndefined();

    vi.setSystemTime(1010);
    useDownloadProgressStore.getState().reportProgress('netease:1', 1);
    expect(useDownloadProgressStore.getState().progressByKey['netease:1']).toBe(1);
  });

  it('进度事件不写 AsyncStorage：写盘离开热路径', () => {
    useDownloadStore.getState().addItem(ITEM);
    const itemsBefore = useDownloadStore.getState().items;
    asyncStorageMock.setItem.mockClear();

    for (let i = 1; i <= 100; i++) {
      useDownloadProgressStore.getState().reportProgress('netease:1', i);
    }

    expect(asyncStorageMock.setItem).not.toHaveBeenCalled();
    // 持久化列表引用不变 → 下载页列表不随进度重渲染
    expect(useDownloadStore.getState().items).toBe(itemsBefore);
  });

  it('持久化记录本身不带 progress 字段', () => {
    useDownloadStore.getState().addItem(ITEM);
    expect('progress' in useDownloadStore.getState().items[0]).toBe(false);
  });

  it('v1 旧数据迁移剥掉 progress，其余字段保留', async () => {
    asyncStorageMock.getItem.mockResolvedValueOnce(
      JSON.stringify({ state: { items: [{ ...ITEM, progress: 42 }] }, version: 1 })
    );

    await useDownloadStore.persist.rehydrate();

    const [item] = useDownloadStore.getState().items;
    expect(item).not.toHaveProperty('progress');
    expect(item.status).toBe('downloading');
    expect(item.fileName).toBe(ITEM.fileName);
  });
});
