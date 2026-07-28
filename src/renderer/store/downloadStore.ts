import { create } from 'zustand';
import type { Song } from '@mplayer/core';

export interface DownloadTask {
  id: string;
  song: Song;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  error?: string;
  filePath?: string;
}

export interface DownloadNotification {
  id: string;
  type: 'single' | 'batch';
  tasks: DownloadTask[];
  isVisible: boolean;
  createdAt: number;
}

interface DownloadStoreState {
  notifications: DownloadNotification[];
}

interface DownloadStoreActions {
  addSingleDownload: (task: DownloadTask) => void;
  addBatchDownload: (tasks: DownloadTask[]) => void;
  updateTask: (taskId: string, updates: Partial<DownloadTask>) => void;
  closeNotification: (notificationId: string) => void;
  removeNotification: (notificationId: string) => void;
  clearCompleted: () => void;
}

export type DownloadStore = DownloadStoreState & DownloadStoreActions;

export const useDownloadStore = create<DownloadStore>((set) => ({
  notifications: [],

  addSingleDownload: (task: DownloadTask) => {
    const notification: DownloadNotification = {
      id: `single_${task.id}_${Date.now()}`,
      type: 'single',
      tasks: [task],
      isVisible: true,
      createdAt: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));
  },

  addBatchDownload: (tasks: DownloadTask[]) => {
    const notification: DownloadNotification = {
      id: `batch_${Date.now()}`,
      type: 'batch',
      tasks: tasks,
      isVisible: true,
      createdAt: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));
  },

  updateTask: (taskId: string, updates: Partial<DownloadTask>) => {
    set((state) => ({
      notifications: state.notifications.map((notification) => ({
        ...notification,
        tasks: notification.tasks.map((task) =>
          task.id === taskId ? { ...task, ...updates } : task
        ),
      })),
    }));
  },

  closeNotification: (notificationId: string) => {
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === notificationId
          ? { ...notification, isVisible: false }
          : notification
      ),
    }));
  },

  removeNotification: (notificationId: string) => {
    set((state) => ({
      notifications: state.notifications.filter(
        (notification) => notification.id !== notificationId
      ),
    }));
  },

  clearCompleted: () => {
    set((state) => ({
      notifications: state.notifications.filter((notification) => {
        const allCompleted = notification.tasks.every(
          (task) => task.status === 'completed' || task.status === 'error'
        );
        return !allCompleted;
      }),
    }));
  },
}));

export const getNotificationStats = (notification: DownloadNotification) => {
  const total = notification.tasks.length;
  const completed = notification.tasks.filter(
    (task) => task.status === 'completed'
  ).length;
  const error = notification.tasks.filter(
    (task) => task.status === 'error'
  ).length;
  const downloading = notification.tasks.filter(
    (task) => task.status === 'downloading'
  ).length;
  const pending = notification.tasks.filter(
    (task) => task.status === 'pending'
  ).length;

  const totalProgress = notification.tasks.reduce(
    (sum, task) => sum + task.progress,
    0
  );
  const averageProgress = total > 0 ? Math.round(totalProgress / total) : 0;

  return {
    total,
    completed,
    error,
    downloading,
    pending,
    averageProgress,
  };
};

export const getStatusText = (status: DownloadTask['status']): string => {
  switch (status) {
    case 'pending':
      return '等待中';
    case 'downloading':
      return '下载中';
    case 'completed':
      return '已完成';
    case 'error':
      return '失败';
    default:
      return '未知';
  }
};

export const getStatusColor = (status: DownloadTask['status']): string => {
  switch (status) {
    case 'pending':
      return 'var(--text-tertiary)';
    case 'downloading':
      return 'var(--primary-color)';
    case 'completed':
      return '#52c41a';
    case 'error':
      return '#ff4d4f';
    default:
      return 'var(--text-secondary)';
  }
};
