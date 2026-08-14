import { useCallback } from 'react';
import { useDownloadStore } from '@/renderer/store/downloadStore';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { DownloadTask } from '@/renderer/store/downloadStore';
import type { Song } from '@mplayer/core';

export function useDownload() {
  const addSingleDownload = useDownloadStore((s) => s.addSingleDownload);
  const addBatchDownload = useDownloadStore((s) => s.addBatchDownload);

  const download = useCallback(async (song: Song) => {
    try {
      const task = await IpcClient.invoke<DownloadTask>('download:start', song);
      if (task) addSingleDownload(task);
    } catch (error) {
      console.error('下载失败:', error);
    }
  }, [addSingleDownload]);

  const downloadBatch = useCallback(async (songs: Song[]) => {
    try {
      const tasks = await IpcClient.invoke<DownloadTask[]>('download:startBatch', songs);
      if (tasks?.length) addBatchDownload(tasks);
    } catch (error) {
      console.error('批量下载失败:', error);
    }
  }, [addBatchDownload]);

  return { download, downloadBatch, addSingleDownload, addBatchDownload };
}
