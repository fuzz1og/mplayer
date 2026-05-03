import React from 'react';
import { X, CheckCircle, AlertCircle, Loader2, Music, Trash2 } from 'lucide-react';
import type { DownloadNotification } from '@/renderer/store/downloadStore';
import { getNotificationStats, getStatusText, getStatusColor, useDownloadStore } from '@/renderer/store/downloadStore';

interface DownloadProgressModalProps {
  notification: DownloadNotification;
  onClose: () => void;
}

const DownloadProgressModal: React.FC<DownloadProgressModalProps> = ({
  notification,
  onClose,
}) => {
  const { type, tasks } = notification;
  const stats = getNotificationStats(notification);

  const isAllCompleted = stats.completed + stats.error === stats.total;
  const hasError = stats.error > 0;

  if (type === 'single') {
    const task = tasks[0];
    if (!task) return null;

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          animation: 'fadeIn 0.2s ease',
        }}
        onClick={onClose}
      >
        <div
          style={{
            backgroundColor: 'var(--bg-color)',
            borderRadius: '12px',
            padding: '24px',
            width: '360px',
            maxWidth: '90vw',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
            animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px',
            }}
          >
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              {isAllCompleted
                ? hasError
                  ? '下载失败'
                  : '下载完成'
                : '正在下载'}
            </h3>
            <button
              onClick={onClose}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                color: 'var(--text-tertiary)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--text-tertiary)';
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* 歌曲信息 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '20px',
            }}
          >
            {/* 封面 */}
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '8px',
                overflow: 'hidden',
                backgroundColor: 'var(--hover-bg)',
                flexShrink: 0,
              }}
            >
              {task.song.cover ? (
                <img
                  src={task.song.cover}
                  alt={task.song.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #E8E8E8 0%, #F0F0F0 100%)',
                  }}
                >
                  <Music size={24} color="#999" />
                </div>
              )}
            </div>

            {/* 歌曲信息 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {task.song.name}
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: '4px',
                }}
              >
                {task.song.artist}
              </div>
            </div>

            {/* 状态图标 */}
            <div>
              {task.status === 'completed' ? (
                <CheckCircle size={24} color="#52c41a" />
              ) : task.status === 'error' ? (
                <AlertCircle size={24} color="#ff4d4f" />
              ) : (
                <Loader2 size={24} color="var(--primary-color)" style={{ animation: 'spin 1s linear infinite' }} />
              )}
            </div>
          </div>

          {/* 进度条 */}
          <div style={{ marginBottom: '12px' }}>
            <div
              style={{
                height: '6px',
                backgroundColor: 'var(--hover-bg)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${task.progress}%`,
                  backgroundColor: task.status === 'error' ? '#ff4d4f' : 'var(--primary-color)',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* 进度文字 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px',
            }}
          >
            <span style={{ color: getStatusColor(task.status) }}>
              {getStatusText(task.status)}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>{task.progress}%</span>
          </div>

          {/* 错误信息 */}
          {task.error && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px 12px',
                backgroundColor: '#fff2f0',
                border: '1px solid #ffccc7',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#ff4d4f',
              }}
            >
              {task.error}
            </div>
          )}

          {/* 清除已完成按钮 */}
          {isAllCompleted && (
            <button
              onClick={() => useDownloadStore.getState().clearCompleted()}
              style={{
                marginTop: '16px',
                width: '100%',
                padding: '10px',
                backgroundColor: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--text-tertiary)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <Trash2 size={14} />
              清除并关闭
            </button>
          )}
        </div>

        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // 批量下载模式
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-color)',
          borderRadius: '12px',
          padding: '24px',
          width: '420px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
          }}
        >
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            {isAllCompleted
              ? `批量下载完成 (${stats.completed}成功${stats.error > 0 ? `, ${stats.error}失败` : ''})`
              : `正在批量下载 (${stats.completed}/${stats.total})`}
          </h3>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              color: 'var(--text-tertiary)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-tertiary)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 总体进度 */}
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
              fontSize: '13px',
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>总体进度</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {stats.averageProgress}%
            </span>
          </div>
          <div
            style={{
              height: '8px',
              backgroundColor: 'var(--hover-bg)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${stats.averageProgress}%`,
                backgroundColor: isAllCompleted
                  ? hasError
                    ? '#ff4d4f'
                    : '#52c41a'
                  : 'var(--primary-color)',
                borderRadius: '4px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>

        {/* 歌曲列表 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            maxHeight: '300px',
            borderTop: '1px solid var(--divider-color)',
            borderBottom: '1px solid var(--divider-color)',
          }}
        >
          {tasks.map((task) => (
            <div
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 0',
                borderBottom: '1px solid var(--divider-color)',
              }}
            >
              {/* 状态图标 */}
              <div style={{ width: '20px', flexShrink: 0 }}>
                {task.status === 'completed' ? (
                  <CheckCircle size={18} color="#52c41a" />
                ) : task.status === 'error' ? (
                  <AlertCircle size={18} color="#ff4d4f" />
                ) : task.status === 'downloading' ? (
                  <Loader2 size={18} color="var(--primary-color)" style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--text-tertiary)',
                      margin: '0 auto',
                    }}
                  />
                )}
              </div>

              {/* 歌曲信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {task.song.name}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: '2px',
                  }}
                >
                  {task.song.artist}
                </div>
              </div>

              {/* 进度 */}
              <div style={{ width: '50px', textAlign: 'right' }}>
                {task.status === 'downloading' ? (
                  <span style={{ fontSize: '12px', color: 'var(--primary-color)' }}>
                    {task.progress}%
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: '12px',
                      color: getStatusColor(task.status),
                    }}
                  >
                    {getStatusText(task.status)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 底部统计 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '16px',
            paddingTop: '16px',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', gap: '16px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              总计: <strong style={{ color: 'var(--text-primary)' }}>{stats.total}</strong>
            </span>
            <span style={{ color: '#52c41a' }}>
              成功: <strong>{stats.completed}</strong>
            </span>
            {stats.error > 0 && (
              <span style={{ color: '#ff4d4f' }}>
                失败: <strong>{stats.error}</strong>
              </span>
            )}
          </div>
        </div>

        {/* 清除已完成按钮 */}
        {isAllCompleted && (
          <button
            onClick={() => useDownloadStore.getState().clearCompleted()}
            style={{
              marginTop: '16px',
              width: '100%',
              padding: '10px',
              backgroundColor: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--text-tertiary)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <Trash2 size={14} />
            清除已完成
          </button>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default DownloadProgressModal;
