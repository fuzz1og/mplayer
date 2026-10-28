import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { CheckCircle, AlertCircle, Loader2, Pause, Music2, Trash2 } from 'lucide-react';
import type { DownloadNotification } from '@/renderer/store/downloadStore';
import { getNotificationStats, getStatusText, getStatusColor, useDownloadStore } from '@/renderer/store/downloadStore';
import { Button, Dialog } from '@/renderer/ui';
import '@/renderer/styles/songlist.css';

interface DownloadProgressModalProps {
  notification: DownloadNotification;
  /** 传通知 id 而非闭包：宿主可传稳定的 store action，memo 才不会被新函数击穿 */
  onClose: (notificationId: string) => void;
}

const DownloadProgressModal: React.FC<DownloadProgressModalProps> = ({
  notification,
  onClose,
}) => {
  const { type, tasks } = notification;
  const handleClose = React.useCallback(() => onClose(notification.id), [onClose, notification.id]);
  const stats = getNotificationStats(notification);

  const isAllCompleted = stats.completed + stats.error === stats.total;
  const hasError = stats.error > 0;
  const clearAndClose = () => {
    useDownloadStore.getState().clearCompleted();
    handleClose();
  };

  if (type === 'single') {
    const task = tasks[0];
    if (!task) return null;

    return (
      <Dialog
        open
        title={isAllCompleted ? (hasError ? '下载失败' : '下载完成') : '正在下载'}
        onClose={handleClose}
        footer={
          isAllCompleted ? (
            <Button variant="ghost" onClick={clearAndClose}>
              <Trash2 size={14} />
              清除并关闭
            </Button>
          ) : undefined
        }
      >
        <div className="dl-progress__song">
          <div className="dl-progress__cover">
            <div className="dl-progress__cover-placeholder">
              <Music2 size={20} />
            </div>
            {task.song.cover && (
              <img
                key={task.song.cover}
                src={coverThumbUrl(task.song.cover, COVER_SIZE.row)}
                alt={task.song.name}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                className="dl-progress__cover-img"
              />
            )}
          </div>

          <div className="dl-progress__song-text">
            <div className="dl-progress__song-name">{task.song.name}</div>
            <div className="dl-progress__song-artist">{task.song.artist}</div>
          </div>

          <div className="dl-progress__status-icon">
            {task.status === 'completed' ? (
              <CheckCircle size={24} color="var(--success)" />
            ) : task.status === 'error' ? (
              <AlertCircle size={24} color="var(--danger)" />
            ) : task.status === 'paused' ? (
              <Pause size={24} color="var(--text-tertiary)" />
            ) : (
              <Loader2 size={24} color="var(--accent)" className="dl-progress__spin" />
            )}
          </div>
        </div>

        <div className="dl-progress__bar-wrap">
          <div className="dl-progress__bar">
            <div
              className="dl-progress__bar-fill"
              data-tone={task.status === 'error' ? 'danger' : undefined}
              style={{ '--progress': `${task.progress}%` } as React.CSSProperties}
            />
          </div>
        </div>

        <div className="dl-progress__progress-text">
          <span style={{ '--status-color': getStatusColor(task.status) } as React.CSSProperties}>
            {getStatusText(task.status)}
          </span>
          <span className="dl-progress__progress-num">{task.progress}%</span>
        </div>

        {task.error && <div className="dl-progress__error">{task.error}</div>}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      title={
        isAllCompleted
          ? `批量下载完成 (${stats.completed}成功${stats.error > 0 ? `, ${stats.error}失败` : ''})`
          : `正在批量下载 (${stats.completed}/${stats.total})`
      }
      onClose={handleClose}
      footer={
        isAllCompleted ? (
          <Button variant="ghost" onClick={clearAndClose}>
            <Trash2 size={14} />
            清除已完成
          </Button>
        ) : undefined
      }
    >
      <div className="dl-progress__overall">
        <div className="dl-progress__overall-head">
          <span>总体进度</span>
          <span className="dl-progress__overall-value">{stats.averageProgress}%</span>
        </div>
        <div className="dl-progress__bar dl-progress__bar--batch">
          <div
            className="dl-progress__bar-fill"
            data-tone={isAllCompleted ? (hasError ? 'danger' : 'success') : undefined}
            style={{ '--progress': `${stats.averageProgress}%` } as React.CSSProperties}
          />
        </div>
      </div>

      <div className="dl-progress__list">
        {tasks.map((task) => (
          <div key={task.id} className="dl-progress__row">
            <div className="dl-progress__row-icon">
              {task.status === 'completed' ? (
                <CheckCircle size={18} color="var(--success)" />
              ) : task.status === 'error' ? (
                <AlertCircle size={18} color="var(--danger)" />
              ) : task.status === 'paused' ? (
                <Pause size={18} color="var(--text-tertiary)" />
              ) : task.status === 'downloading' ? (
                <Loader2 size={18} color="var(--accent)" className="dl-progress__spin" />
              ) : (
                <div className="dl-progress__dot" />
              )}
            </div>

            <div className="dl-progress__row-text">
              <div className="dl-progress__row-name">{task.song.name}</div>
              <div className="dl-progress__row-artist">{task.song.artist}</div>
            </div>

            <div className={`dl-progress__row-state${task.status === 'downloading' ? ' dl-progress__row-state--active' : ''}`}>
              {task.status === 'downloading' ? (
                `${task.progress}%`
              ) : (
                <span style={{ '--status-color': getStatusColor(task.status) } as React.CSSProperties}>
                  {getStatusText(task.status)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="dl-progress__footer">
        <div className="dl-progress__footer-stats">
          <span>
            总计: <strong className="dl-progress__footer-strong">{stats.total}</strong>
          </span>
          <span className="dl-progress__footer-success">
            成功: <strong>{stats.completed}</strong>
          </span>
          {stats.error > 0 && (
            <span className="dl-progress__footer-danger">
              失败: <strong>{stats.error}</strong>
            </span>
          )}
        </div>
      </div>
    </Dialog>
  );
};

// 通知对象保持同一性（downloadStore.updateTask）时，未变化的弹窗跳过重渲染
export default React.memo(DownloadProgressModal);
