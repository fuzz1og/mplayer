import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Music2, Pause, Play, Trash2, X } from 'lucide-react';
import type { Song } from '@mplayer/core';
import { Button, Dialog, Progress } from '@/renderer/ui';
import { IpcClient } from '@/renderer/services/IpcClient';
import { toast } from '@/renderer/services/toastStore';
import '@/renderer/styles/library.css';

/** 下载管理 = 「本地」页的次级入口（#694）：页头「已下载」打开，不再单独占一个分段。 */

interface DownloadTaskRow {
  id: string;
  song: Song;
  progress: number;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error';
  error?: string;
}

const TASK_LABELS: Record<DownloadTaskRow['status'], string> = {
  pending: '等待中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  error: '失败',
};

interface DownloadsDialogProps {
  open: boolean;
  onClose: () => void;
}

const DownloadsDialog: React.FC<DownloadsDialogProps> = ({ open, onClose }) => {
  const [downloadPath, setDownloadPath] = useState('');
  const [tasks, setTasks] = useState<DownloadTaskRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDownloads = useCallback(async () => {
    setLoading(true);
    try {
      const [path, rows] = await Promise.all([
        IpcClient.invoke<string>('settings:getDownloadPath'),
        IpcClient.invoke<DownloadTaskRow[]>('download:getTasks'),
      ]);
      setDownloadPath(path ?? '');
      setTasks(rows ?? []);
    } catch (error) {
      console.error('加载下载信息失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadDownloads();
    const api = window.electronAPI;
    if (!api?.on) return;
    const refresh = () => { void loadDownloads(); };
    const offProgress = api.on('download:progress', refresh);
    const offComplete = api.on('download:complete', refresh);
    const offError = api.on('download:error', refresh);
    return () => {
      offProgress?.();
      offComplete?.();
      offError?.();
    };
  }, [open, loadDownloads]);

  const handleChangeDownloadPath = useCallback(async () => {
    try {
      const picked = await IpcClient.invoke<{ canceled: boolean; filePaths: string[] }>('dialog:openDirectory', 'download');
      if (picked?.canceled || !picked?.filePaths?.length) return;
      await IpcClient.invoke('settings:setDownloadPath', picked.filePaths[0]);
      setDownloadPath(picked.filePaths[0]);
      toast.success('下载目录已更新');
    } catch (error) {
      console.error('更新下载目录失败:', error);
      toast.error('更新下载目录失败');
    }
  }, []);

  const handleOpenDownloadDir = useCallback(async () => {
    try {
      const opened = await IpcClient.invoke<boolean>('download:openDir');
      if (opened === false) toast.error('打开下载目录失败');
    } catch (error) {
      console.error('打开下载目录失败:', error);
      toast.error('打开下载目录失败');
    }
  }, []);

  const runTaskAction = useCallback(async (channel: string, taskId: string, fallback: string) => {
    try {
      await IpcClient.invoke(channel, taskId);
      await loadDownloads();
    } catch (error) {
      console.error(fallback + ':', error);
      toast.error(fallback);
    }
  }, [loadDownloads]);

  const handleClearFinished = useCallback(async () => {
    try {
      await IpcClient.invoke('download:clearCompleted');
      await loadDownloads();
    } catch (error) {
      console.error('清除已完成下载失败:', error);
      toast.error('清除失败');
    }
  }, [loadDownloads]);

  const finishedCount = tasks.filter((task) => task.status === 'completed' || task.status === 'error').length;

  return (
    <Dialog
      open={open}
      title="已下载"
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <div className="library__dir">
        <span className="library__dir-label">下载目录</span>
        <span className="library__dir-path" title={downloadPath}>{downloadPath || '加载中…'}</span>
        <button type="button" className="library__text-btn" onClick={() => void handleChangeDownloadPath()}>
          更改
        </button>
        <button
          type="button"
          className="library__text-btn"
          aria-label="打开目录"
          onClick={() => void handleOpenDownloadDir()}
        >
          <FolderOpen size={15} aria-hidden="true" />
          打开目录
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="library__empty">
          <Music2 size={26} aria-hidden="true" />
          {loading ? (
            <div className="library__empty-title">加载中…</div>
          ) : (
            <>
              <div className="library__empty-title">暂无下载任务</div>
              <div className="library__empty-sub">在歌曲「更多」菜单里选择下载，任务会出现在这里。</div>
            </>
          )}
        </div>
      ) : (
        <>
          {tasks.map((task) => (
            <div key={task.id} className="library__task-row">
              <span className="library__task-main">
                <span className="library__task-name">{task.song.name}</span>
                <span className="library__task-meta">{task.song.artist}</span>
              </span>
              <span className="library__task-bar">
                <Progress
                  value={task.progress}
                  tone={task.status === 'error' ? 'danger' : task.status === 'completed' ? 'success' : 'accent'}
                  ariaLabel={task.song.name + ' 下载进度'}
                />
              </span>
              <span className="library__task-state" data-tone={task.status}>
                {task.status === 'downloading' ? Math.round(task.progress) + '%' : TASK_LABELS[task.status]}
              </span>
              {(task.status === 'pending' || task.status === 'paused') && (
                <button
                  type="button"
                  className="library__task-cancel"
                  aria-label={'开始下载: ' + task.song.name}
                  disabled={task.status === 'pending'}
                  title={task.status === 'pending' ? '等待队列自动开始' : undefined}
                  onClick={() => void runTaskAction('download:resume', task.id, '继续下载失败')}
                >
                  <Play size={14} aria-hidden="true" />
                </button>
              )}
              {task.status === 'downloading' && (
                <button
                  type="button"
                  className="library__task-cancel"
                  aria-label={'暂停下载: ' + task.song.name}
                  onClick={() => void runTaskAction('download:pause', task.id, '暂停下载失败')}
                >
                  <Pause size={14} aria-hidden="true" />
                </button>
              )}
              {(task.status === 'pending' || task.status === 'downloading' || task.status === 'paused') && (
                <button
                  type="button"
                  className="library__task-cancel"
                  aria-label={'取消下载: ' + task.song.name}
                  onClick={() => void runTaskAction('download:cancel', task.id, '取消下载失败')}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
              {task.status === 'completed' && (
                <button
                  type="button"
                  className="library__task-cancel"
                  aria-label={'打开所在文件夹: ' + task.song.name}
                  onClick={() => void runTaskAction('download:showInFolder', task.id, '打开所在文件夹失败')}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                </button>
              )}
              {task.status === 'error' && <span className="library__task-cancel" aria-hidden="true" />}
            </div>
          ))}
          {finishedCount > 0 && (
            <div className="library__task-foot">
              <button type="button" className="library__text-btn" onClick={() => void handleClearFinished()}>
                <Trash2 size={14} aria-hidden="true" />
                清除已完成（{finishedCount}）
              </button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
};

export default DownloadsDialog;
