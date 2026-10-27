import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { X, CheckCircle, AlertCircle, Loader2, Trash2, Music2 } from 'lucide-react';
import type { DownloadNotification } from '@/renderer/store/downloadStore';
import { getNotificationStats, getStatusText, getStatusColor, useDownloadStore } from '@/renderer/store/downloadStore';
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

  if (type === 'single') {
    const task = tasks[0];
    if (!task) return null;

    return (
      <div className="dl-modal" onClick={handleClose}>
        <div className="dl-modal__panel" onClick={(e) => e.stopPropagation()}>
          {/* 头部 */}
          <div className="dl-modal__head">
            <h3 className="dl-modal__title">
              {isAllCompleted ? (hasError ? '下载失败' : '下载完成') : '正在下载'}
            </h3>
            <button onClick={handleClose} className="dl-modal__close" aria-label="关闭">
              <X size={18} />
            </button>
          </div>

          {/* 歌曲信息 */}
          <div className="dl-modal__song">
            <div className="dl-modal__cover">
              <div className="dl-modal__cover-placeholder">
                <Music2 size={20} />
              </div>
              {task.song.cover && (
                <img
                  key={task.song.cover}
                  src={coverThumbUrl(task.song.cover, COVER_SIZE.row)}
                  alt={task.song.name}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="dl-modal__cover-img"
                />
              )}
            </div>

            <div className="dl-modal__song-text">
              <div className="dl-modal__song-name">{task.song.name}</div>
              <div className="dl-modal__song-artist">{task.song.artist}</div>
            </div>

            <div className="dl-modal__status-icon">
              {task.status === 'completed' ? (
                <CheckCircle size={24} color="var(--success)" />
              ) : task.status === 'error' ? (
                <AlertCircle size={24} color="var(--danger)" />
              ) : (
                <Loader2 size={24} color="var(--accent)" className="dl-modal__spin" />
              )}
            </div>
          </div>

          {/* 进度条 */}
          <div className="dl-modal__bar-wrap">
            <div className="dl-modal__bar">
              <div
                className="dl-modal__bar-fill"
                data-tone={task.status === 'error' ? 'danger' : undefined}
                style={{ '--progress': `${task.progress}%` } as React.CSSProperties}
              />
            </div>
          </div>

          {/* 进度文字 */}
          <div className="dl-modal__progress-text">
            <span style={{ '--status-color': getStatusColor(task.status) } as React.CSSProperties}>
              {getStatusText(task.status)}
            </span>
            <span className="dl-modal__progress-num">{task.progress}%</span>
          </div>

          {/* 错误信息 */}
          {task.error && <div className="dl-modal__error">{task.error}</div>}

          {/* 清除已完成按钮 */}
          {isAllCompleted && (
            <button onClick={() => useDownloadStore.getState().clearCompleted()} className="dl-modal__clear">
              <Trash2 size={14} />
              清除并关闭
            </button>
          )}
        </div>

      </div>
    );
  }

  // 批量下载模式
  return (
    <div className="dl-modal" onClick={handleClose}>
      <div className="dl-modal__panel dl-modal__panel--batch" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="dl-modal__head">
          <h3 className="dl-modal__title">
            {isAllCompleted
              ? `批量下载完成 (${stats.completed}成功${stats.error > 0 ? `, ${stats.error}失败` : ''})`
              : `正在批量下载 (${stats.completed}/${stats.total})`}
          </h3>
          <button onClick={handleClose} className="dl-modal__close" aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {/* 总体进度 */}
        <div className="dl-modal__overall">
          <div className="dl-modal__overall-head">
            <span>总体进度</span>
            <span className="dl-modal__overall-value">{stats.averageProgress}%</span>
          </div>
          <div className="dl-modal__bar dl-modal__bar--batch">
            <div
              className="dl-modal__bar-fill"
              data-tone={isAllCompleted ? (hasError ? 'danger' : 'success') : undefined}
              style={{ '--progress': `${stats.averageProgress}%` } as React.CSSProperties}
            />
          </div>
        </div>

        {/* 歌曲列表 */}
        <div className="dl-modal__list">
          {tasks.map((task) => (
            <div key={task.id} className="dl-modal__row">
              {/* 状态图标 */}
              <div className="dl-modal__row-icon">
                {task.status === 'completed' ? (
                  <CheckCircle size={18} color="var(--success)" />
                ) : task.status === 'error' ? (
                  <AlertCircle size={18} color="var(--danger)" />
                ) : task.status === 'downloading' ? (
                  <Loader2 size={18} color="var(--accent)" className="dl-modal__spin" />
                ) : (
                  <div className="dl-modal__dot" />
                )}
              </div>

              {/* 歌曲信息 */}
              <div className="dl-modal__row-text">
                <div className="dl-modal__row-name">{task.song.name}</div>
                <div className="dl-modal__row-artist">{task.song.artist}</div>
              </div>

              {/* 进度 */}
              <div className={`dl-modal__row-state${task.status === 'downloading' ? ' dl-modal__row-state--active' : ''}`}>
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

        {/* 底部统计 */}
        <div className="dl-modal__footer">
          <div className="dl-modal__footer-stats">
            <span>
              总计: <strong className="dl-modal__footer-strong">{stats.total}</strong>
            </span>
            <span className="dl-modal__footer-success">
              成功: <strong>{stats.completed}</strong>
            </span>
            {stats.error > 0 && (
              <span className="dl-modal__footer-danger">
                失败: <strong>{stats.error}</strong>
              </span>
            )}
          </div>
        </div>

        {/* 清除已完成按钮 */}
        {isAllCompleted && (
          <button onClick={() => useDownloadStore.getState().clearCompleted()} className="dl-modal__clear">
            <Trash2 size={14} />
            清除已完成
          </button>
        )}
      </div>

    </div>
  );
};

// 通知对象保持同一性（downloadStore.updateTask）时，未变化的弹窗跳过重渲染
export default React.memo(DownloadProgressModal);
