import React from 'react';
import { useDownloadStore } from '@/renderer/store/downloadStore';
import DownloadProgressModal from '@/renderer/components/DownloadProgressModal';

/**
 * 下载通知宿主：把下载 store 的订阅面收在这一层（App 不再整 store 订阅，进度事件不重渲染整棵页面树
 * ）。
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
