import React from 'react';
import { useDownloadStore } from '@/renderer/store/downloadStore';
import DownloadProgressModal from '@/renderer/components/DownloadProgressModal';

/**
 * 下载通知宿主：把下载 store 的订阅面收在这一层（App 不再整 store 订阅，
 * 进度事件不重渲染整棵页面树）。每个弹窗只拿自己那条 notification：
 * updateTask 保持未变化对象的同一性，配合弹窗的 React.memo，
 * 一次进度只会重渲染真正变化的那一个弹窗。
 */
const DownloadNotifications: React.FC = () => {
  const notifications = useDownloadStore((s) => s.notifications);
  const closeNotification = useDownloadStore((s) => s.closeNotification);

  return (
    <>
      {notifications.map((notification) =>
        notification.isVisible ? (
          <DownloadProgressModal
            key={notification.id}
            notification={notification}
            onClose={closeNotification}
          />
        ) : null
      )}
    </>
  );
};

export default DownloadNotifications;
