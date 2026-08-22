import { describe, it, expect, beforeEach } from 'vitest';
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
