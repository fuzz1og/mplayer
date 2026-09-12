import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDownloadStore, getNotificationStats, getStatusText, getStatusColor } from '../store/downloadStore';
import type { DownloadTask, DownloadNotification } from '../store/downloadStore';

describe('downloadStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    useDownloadStore.setState({
      notifications: []
    });
  });

  describe('下载通知管理', () => {
    it('应该添加单曲下载任务', () => {
      const { addSingleDownload } = useDownloadStore.getState();
      const task: DownloadTask = {
        id: '1',
        song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        progress: 0,
        status: 'pending'
      };
      addSingleDownload(task);
      expect(useDownloadStore.getState().notifications).toHaveLength(1);
      expect(useDownloadStore.getState().notifications[0].type).toBe('single');
    });

    it('应该添加批量下载任务', () => {
      const { addBatchDownload } = useDownloadStore.getState();
      const tasks: DownloadTask[] = [
        {
          id: '1',
          song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
          progress: 0,
          status: 'pending'
        },
        {
          id: '2',
          song: { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' },
          progress: 0,
          status: 'pending'
        }
      ];
      addBatchDownload(tasks);
      expect(useDownloadStore.getState().notifications).toHaveLength(1);
      expect(useDownloadStore.getState().notifications[0].type).toBe('batch');
      expect(useDownloadStore.getState().notifications[0].tasks).toHaveLength(2);
    });

    it('应该更新任务状态', () => {
      const { addSingleDownload, updateTask } = useDownloadStore.getState();
      const task: DownloadTask = {
        id: '1',
        song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        progress: 0,
        status: 'pending'
      };
      addSingleDownload(task);
      updateTask('1', { progress: 50, status: 'downloading' });
      const updatedTask = useDownloadStore.getState().notifications[0].tasks[0];
      expect(updatedTask.progress).toBe(50);
      expect(updatedTask.status).toBe('downloading');
    });

    it('应该关闭通知', () => {
      const { addSingleDownload, closeNotification } = useDownloadStore.getState();
      const task: DownloadTask = {
        id: '1',
        song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        progress: 0,
        status: 'pending'
      };
      addSingleDownload(task);
      const notificationId = useDownloadStore.getState().notifications[0].id;
      closeNotification(notificationId);
      expect(useDownloadStore.getState().notifications[0].isVisible).toBe(false);
    });

    it('应该移除通知', () => {
      const { addSingleDownload, removeNotification } = useDownloadStore.getState();
      const task: DownloadTask = {
        id: '1',
        song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        progress: 0,
        status: 'pending'
      };
      addSingleDownload(task);
      const notificationId = useDownloadStore.getState().notifications[0].id;
      removeNotification(notificationId);
      expect(useDownloadStore.getState().notifications).toHaveLength(0);
    });

    it('应该清空已完成的任务', () => {
      const { addSingleDownload, clearCompleted } = useDownloadStore.getState();
      const task1: DownloadTask = {
        id: '1',
        song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        progress: 100,
        status: 'completed'
      };
      const task2: DownloadTask = {
        id: '2',
        song: { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' },
        progress: 50,
        status: 'downloading'
      };
      addSingleDownload(task1);
      addSingleDownload(task2);
      clearCompleted();
      // 应该只保留未完成的通知
      expect(useDownloadStore.getState().notifications).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 进度事件的对象同一性（#305）：只重建真正变化的那一条通知/任务
// ---------------------------------------------------------------------------
describe('downloadStore 更新同一性', () => {
  const makeTask = (id: string, progress = 0): DownloadTask => ({
    id,
    song: { id, name: `歌${id}`, artist: '周杰伦', album: '' },
    progress,
    status: 'downloading',
  });

  beforeEach(() => {
    useDownloadStore.setState({ notifications: [] });
  });

  it('未命中的通知与任务保持引用，只有命中的那条被重建', () => {
    const { addBatchDownload, addSingleDownload, updateTask } = useDownloadStore.getState();
    addBatchDownload([makeTask('1'), makeTask('2')]);
    addSingleDownload(makeTask('3'));

    const before = useDownloadStore.getState().notifications;
    const [batchBefore, singleBefore] = before;

    updateTask('1', { progress: 30 });

    const after = useDownloadStore.getState().notifications;
    expect(after[0]).not.toBe(batchBefore);          // 命中的通知被重建
    expect(after[1]).toBe(singleBefore);             // 未命中通知保持同一引用
    expect(after[0].tasks[1]).toBe(batchBefore.tasks[1]); // 未命中任务保持同一引用
    expect(after[0].tasks[0].progress).toBe(30);
  });

  it('更新值与现值全等时 state 不换、订阅者不被唤醒', () => {
    const { addSingleDownload, updateTask } = useDownloadStore.getState();
    addSingleDownload(makeTask('1', 0));
    const state = useDownloadStore.getState();
    const listener = vi.fn();
    const unsubscribe = useDownloadStore.subscribe(listener);

    updateTask('1', { progress: 0, status: 'downloading' });

    expect(useDownloadStore.getState()).toBe(state);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('未命中任何任务时同样不通知订阅者', () => {
    const { addSingleDownload, updateTask } = useDownloadStore.getState();
    addSingleDownload(makeTask('1'));
    const state = useDownloadStore.getState();
    const listener = vi.fn();
    const unsubscribe = useDownloadStore.subscribe(listener);

    updateTask('missing', { progress: 80 });

    expect(useDownloadStore.getState()).toBe(state);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('重复进度值只通知一次（主进程重复推送不放大重渲染）', () => {
    const { addSingleDownload, updateTask } = useDownloadStore.getState();
    addSingleDownload(makeTask('1'));
    const listener = vi.fn();
    const unsubscribe = useDownloadStore.subscribe(listener);

    updateTask('1', { progress: 42 });
    updateTask('1', { progress: 42 });
    updateTask('1', { progress: 42 });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('getNotificationStats', () => {
  it('应该正确计算通知统计信息', () => {
    const notification: DownloadNotification = {
      id: '1',
      type: 'batch',
      tasks: [
        { id: '1', song: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' }, progress: 100, status: 'completed' },
        { id: '2', song: { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' }, progress: 50, status: 'downloading' },
        { id: '3', song: { id: '3', name: '七里香', artist: '周杰伦', album: '七里香' }, progress: 0, status: 'pending' },
        { id: '4', song: { id: '4', name: '夜曲', artist: '周杰伦', album: '十一月的肖邦' }, progress: 0, status: 'error' }
      ],
      isVisible: true,
      createdAt: Date.now()
    };

    const stats = getNotificationStats(notification);
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.downloading).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.error).toBe(1);
    expect(stats.averageProgress).toBe(38); // (100 + 50 + 0 + 0) / 4 = 37.5, 四舍五入为 38
  });
});

describe('getStatusText', () => {
  it('应该返回正确的状态文本', () => {
    expect(getStatusText('pending')).toBe('等待中');
    expect(getStatusText('downloading')).toBe('下载中');
    expect(getStatusText('completed')).toBe('已完成');
    expect(getStatusText('error')).toBe('失败');
  });
});

describe('getStatusColor', () => {
  it('应该返回正确的状态颜色', () => {
    expect(getStatusColor('pending')).toBe('var(--text-tertiary)');
    expect(getStatusColor('downloading')).toBe('var(--accent)');
    expect(getStatusColor('completed')).toBe('var(--success)');
    expect(getStatusColor('error')).toBe('var(--danger)');
  });
});
